const crypto = require("crypto");
const dns = require("dns/promises");
const fs = require("fs/promises");
const net = require("net");
const path = require("path");
const { chromium } = require("playwright");
const { ROOT, SESSION_WEB_DIR, SESSION_WEB_PAGES_LIMIT } = require("../constants");
const { slugify, normalizeText } = require("./markdown");
const { truncateToTokenBudget } = require("./text");

const DEFAULT_TIMEOUT_MS = 30000;
const MIN_TEXT_LENGTH = 80;
const MAX_TEXT_CHARS = 160000;
const WEB_CONTEXT_TOKEN_BUDGET = 30000;
const SCROLL_PAUSE_MS = 400;
const MAX_SCROLL_COUNT = 30;
const NETWORK_IDLE_TIMEOUT_MS = 8000;

function isPrivateIPv4(address) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIPv6(address) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    return isPrivateIPv4(address);
  }
  if (version === 6) {
    return isPrivateIPv6(address);
  }
  return true;
}

async function validatePublicHttpUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Enter a valid http or https URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  if (!url.hostname || ["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) {
    throw new Error("Localhost URLs are not allowed.");
  }

  if (net.isIP(url.hostname) && isPrivateAddress(url.hostname)) {
    throw new Error("Private network URLs are not allowed.");
  }

  let addresses = [];
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new Error("Could not resolve this URL hostname.");
  }

  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Private network URLs are not allowed.");
  }

  return url.toString();
}

function escapeMarkdown(value) {
  return String(value || "").replace(/\|/g, "\\|").trim();
}

function buildMarkdown({ title, url, fetchedAt, text, metadata }) {
  const lines = [`# ${title || "Web Page"}`, ""];
  if (metadata) {
    if (metadata.description) {
      lines.push(`> ${metadata.description}`, "");
    }
    if (metadata.author || metadata.publishedDate || metadata.siteName) {
      const metaParts = [];
      if (metadata.author) metaParts.push(`Author: ${metadata.author}`);
      if (metadata.publishedDate) metaParts.push(`Published: ${metadata.publishedDate}`);
      if (metadata.siteName) metaParts.push(`Site: ${metadata.siteName}`);
      lines.push(`_${metaParts.join(" | ")}_`, "");
    }
  }
  lines.push(
    `Source URL: ${url}`,
    `Fetched at: ${fetchedAt}`,
    "",
    normalizeText(text),
    "",
  );
  return lines.join("\n");
}

async function scrollAndWaitForContent(page) {
  try {
    const scrollPauseMs = Number(process.env.WEB_PAGE_SCROLL_DELAY_MS) || SCROLL_PAUSE_MS;
    const maxScrolls = Number(process.env.WEB_PAGE_MAX_SCROLL_COUNT) || MAX_SCROLL_COUNT;

    let previousHeight = 0;
    let scrollCount = 0;

    for (let i = 0; i < maxScrolls; i++) {
      scrollCount = i + 1;
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === previousHeight) {
        break;
      }
      previousHeight = currentHeight;
      await page.evaluate((scrollStep) => {
        window.scrollBy(0, window.innerHeight * 0.8);
      }, i);
      await new Promise((resolve) => setTimeout(resolve, scrollPauseMs));
    }

    if (scrollCount > 1) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    try {
      await page.waitForLoadState("networkidle", {
        timeout: Number(process.env.WEB_PAGE_NETWORK_IDLE_TIMEOUT_MS) || NETWORK_IDLE_TIMEOUT_MS,
      });
    } catch {}
  } catch {}
}

async function dismissOverlays(page) {
  try {
    await page.evaluate(() => {
      const selectors = [
        "[id*='cookie-accept']",
        "[id*='cookie-consent'] button",
        "[class*='cookie-accept']",
        "[class*='cookie-consent'] button",
        "[aria-label*='accept cookies' i]",
        "[aria-label*='close' i]",
        "[data-testid='cookie-consent-accept']",
        ".cc-btn",
        ".cc_btn_accept_all",
        ".cc-dismiss",
        "[id*='onetrust-accept-btn-handler']",
        "#onetrust-accept-btn-handler",
        "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
        ".consent-accept",
        "[id*='consent-accept']",
        "[class*='consent-accept']",
        ".paywall-dismiss",
        "[class*='modal-close']",
        ".modal .close",
        "[class*='overlay-close']",
        "[aria-label*='dismiss' i]",
        "[aria-label*='close dialog' i]",
        "[class*='notice-dismiss']",
        ".newsletter-close",
        "[class*='popup-close']",
        "[class*='popup'] [class*='close']",
        "#interstitial-dismiss",
        "[role='dialog'] [aria-label*='close' i]",
      ];
      for (const selector of selectors) {
        try {
          const el = document.querySelector(selector);
          if (el && el.offsetParent !== null) {
            el.click();
          }
        } catch {}
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch {}
}

async function renderWebPageToMarkdown(urlValue) {
  const url = await validatePublicHttpUrl(urlValue);
  const browser = await chromium.launch({ headless: true });
  const fetchedAt = new Date().toISOString();

  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    await page.route("**/*", async (route) => {
      try {
        await validatePublicHttpUrl(route.request().url());
        await route.continue();
      } catch {
        await route.abort();
      }
    });
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.WEB_PAGE_FETCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    });
    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch {}

    await dismissOverlays(page);
    await scrollAndWaitForContent(page);

    const extracted = await page.evaluate(() => {
      const BLOCK_TAGS = new Set([
        "P", "DIV", "SECTION", "ARTICLE", "TABLE", "TBODY", "THEAD", "TR",
        "UL", "OL", "BLOCKQUOTE", "PRE", "DL", "DT", "DD", "FIGURE", "FIELDSET",
        "MAIN", "ASIDE", "HEADER", "FOOTER", "NAV",
      ]);
      const INLINE_TAGS = new Set([
        "SPAN", "EM", "I", "STRONG", "B", "U", "S", "DEL", "INS", "MARK",
        "CODE", "KBD", "SAMP", "SMALL", "SUB", "SUP", "ABBR", "CITE", "Q",
        "TIME", "LABEL", "A", "IMG", "BR",
      ]);
      const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

      const BOILERPLATE_REMOVAL_SELECTORS = [
        "script", "style", "noscript", "svg", "canvas", "template", "iframe",
        "form", "button", "input", "select", "textarea",
        "[hidden]", "[aria-hidden='true']",
        "[role='navigation']",
        ".mw-editsection", ".mw-jump-link", ".mw-empty-elt",
        ".metadata", ".noprint", ".navbox", ".vertical-navbox",
        ".sidebar", ".toc", "#toc", ".printfooter", ".catlinks",
        ".reflist", ".references", ".reference", ".mw-references-wrap",
      ];

      const BOILERPLATE_PATTERNS = [
        /^(cookie|cookies|privacy|gdpr|consent|subscribe|newsletter|sign.?up|register|login|log.?in|advertisement|sponsor|promo|promoted|share|social|comment|related|recommend|trending|popular|most.?read|you.?may.?like)/i,
        /^(share|like|follow|subscribe|comment)/i,
        /^(footer|sidebar|widget|banner|popup|modal|overlay|paywall)/i,
        /^(nav|navigation|menu|breadcrumb|pagination)/i,
      ];

      function clean(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
      }

      function extractMetadata() {
        const metadata = {};
        const ogTitle = document.querySelector("meta[property='og:title']");
        if (ogTitle) {
          metadata.ogTitle = ogTitle.getAttribute("content") || "";
        }
        const description = document.querySelector("meta[name='description'], meta[property='og:description']");
        if (description) {
          metadata.description = description.getAttribute("content") || "";
        }
        const author = document.querySelector("meta[name='author'], meta[property='article:author']");
        if (author) {
          metadata.author = author.getAttribute("content") || "";
        }
        const publishedDate = document.querySelector("meta[property='article:published_time'], meta[name='date']");
        if (publishedDate) {
          metadata.publishedDate = publishedDate.getAttribute("content") || "";
        }
        const siteName = document.querySelector("meta[property='og:site_name']");
        if (siteName) {
          metadata.siteName = siteName.getAttribute("content") || "";
        }

        try {
          const jsonldNodes = document.querySelectorAll("script[type='application/ld+json']");
          for (const node of jsonldNodes) {
            try {
              const data = JSON.parse(node.textContent || "{}");
              const graph = data["@graph"] || [data];
              const articles = (Array.isArray(graph) ? graph : [graph]).filter(
                (item) => item && ["Article", "NewsArticle", "BlogPosting", "WebPage"].includes(item["@type"])
              );
              for (const item of articles) {
                if (!metadata.description && item.description) {
                  metadata.description = String(item.description);
                }
                if (!metadata.author && item.author) {
                  const authorData = Array.isArray(item.author) ? item.author[0] : item.author;
                  metadata.author = String(authorData?.name || authorData || "");
                }
                if (!metadata.publishedDate && item.datePublished) {
                  metadata.publishedDate = String(item.datePublished);
                }
              }
            } catch {}
          }
        } catch {}

        return metadata;
      }

      function getTextContent(node) {
        return (node.textContent || node.innerText || "").trim();
      }

      function getDirectTextLength(node) {
        let length = 0;
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            length += (child.textContent || "").trim().length;
          }
        }
        return length;
      }

      function countLinks(node) {
        const links = node.querySelectorAll("a[href]");
        let linkTextLength = 0;
        for (const link of links) {
          linkTextLength += (link.textContent || "").trim().length;
        }
        return { count: links.length, textLength: linkTextLength };
      }

      function countHeadings(node) {
        return node.querySelectorAll("h1, h2, h3, h4, h5, h6").length;
      }

      function hasBoilerplateClassOrId(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        const className = (node.className && typeof node.className === "string") ? node.className : "";
        const id = node.id || "";
        const combined = `${className} ${id}`.toLowerCase();
        return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(combined));
      }

      function isBranchElement(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        const tag = node.tagName;
        return BLOCK_TAGS.has(tag) || HEADING_TAGS.has(tag);
      }

      function isLikelyBoilerplate(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

        if (hasBoilerplateClassOrId(node)) return true;

        const tag = node.tagName;
        if (tag === "NAV" || tag === "HEADER" || tag === "FOOTER") return true;

        const totalText = getTextContent(node).length;
        if (totalText === 0) {
          const hasMeaningfulChild = Array.from(node.children).some(
            (child) => child.tagName === "IMG" || child.tagName === "VIDEO" || child.tagName === "AUDIO"
          );
          return !hasMeaningfulChild;
        }

        const { textLength: linkTextLength } = countLinks(node);

        if (totalText > 0 && linkTextLength / totalText > 0.5) return true;

        if (totalText < 80 && linkTextLength > 30) return true;

        const paragraphs = node.querySelectorAll("p, li, td, th");
        let contentParagraphs = 0;
        for (const p of paragraphs) {
          if ((p.textContent || "").trim().length >= 40) contentParagraphs++;
        }
        const directChildren = Array.from(node.children);
        if (directChildren.length >= 3 && contentParagraphs === 0) return true;

        if (tag === "FOOTER") return true;

        return false;
      }

      function scoreNode(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return 0;

        const tag = node.tagName;

        const totalText = getTextContent(node).length;
        if (totalText < 100) {
          const hasImg = node.querySelector("img") !== null;
          return hasImg ? 20 : 0;
        }

        const directText = getDirectTextLength(node);
        const children = Array.from(node.children).filter(
          (child) => child.nodeType === Node.ELEMENT_NODE && child.tagName !== "SCRIPT" && child.tagName !== "STYLE"
        );
        const branchChildren = children.filter(isBranchElement);

        const textRatio = directText / Math.max(1, totalText);

        let score = totalText * 0.2;

        score += textRatio * 100;

        const headingCount = countHeadings(node);
        score += headingCount * 25;

        const { count: linkCount, textLength: linkTextLength } = countLinks(node);
        const linkRatio = totalText > 0 ? linkTextLength / totalText : 0;
        score -= linkRatio * 80;

        if (linkCount > 0) {
          const avgLinkLength = linkTextLength / linkCount;
          if (avgLinkLength < 15) {
            score -= (15 - avgLinkLength) * 2;
          }
        }

        if (branchChildren.length > 0 && children.length > 0) {
          const branchRatio = branchChildren.length / children.length;
          score += branchRatio * 20;
        }

        if (tag === "ARTICLE" || tag === "MAIN") {
          score += 60;
        }
        if ((node.getAttribute && node.getAttribute("role") === "main") || node.id === "content") {
          score += 40;
        }

        const className = (node.className && typeof node.className === "string" ? node.className : "").toLowerCase();
        const id = (node.id || "").toLowerCase();
        const classId = `${className} ${id}`;

        if (/\b(article|post|content|entry|main|body|story)\b/.test(classId)) {
          score += 30;
        }

        if (/\b(sidebar|footer|nav|comment|widget|related|recommend|trending|popular|ad|banner|popup|modal|overlay|paywall|cookie|newsletter|subscribe|signup|menu)\b/.test(classId)) {
          score -= 100;
        }

        return Math.max(0, score);
      }

      function findContentRoot() {
        const candidates = [];

        const semanticSelectors = [
          "[role='main']",
          "main",
          "article",
          "#content",
          "#main",
          "#main-content",
          "#article",
          "#article-body",
          "#post-content",
          ".post-content",
          ".article-content",
          ".entry-content",
          ".content-body",
          ".story-body",
        ];

        for (const selector of semanticSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              if (el && getTextContent(el).length > 200) {
                candidates.push(el);
              }
            }
          } catch {}
        }

        if (candidates.length) {
          candidates.sort((a, b) => scoreNode(b) - scoreNode(a));
          const best = candidates[0];
          if (scoreNode(best) > 50) return best;
        }

        const allNodes = document.querySelectorAll("div, section, article, main");
        for (const node of allNodes) {
          candidates.push(node);
        }

        candidates.sort((a, b) => scoreNode(b) - scoreNode(a));
        const topCandidate = candidates[0];
        if (topCandidate && scoreNode(topCandidate) > 30) return topCandidate;

        for (const node of candidates) {
          if (getTextContent(node).length > 500) return node;
        }

        return document.body;
      }

      function cleanBoilerplate(root) {
        if (!root) return root;
        const clone = root.cloneNode(true);

        for (const selector of BOILERPLATE_REMOVAL_SELECTORS) {
          try {
            clone.querySelectorAll(selector).forEach((el) => el.remove());
          } catch {}
        }

        function findRemovableNode(node) {
          if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
          const tag = node.tagName;
          if (tag === "NAV" || tag === "FOOTER" || tag === "HEADER" || tag === "IFRAME") return true;

          const className = (node.className && typeof node.className === "string" ? node.className : "").toLowerCase();
          const id = (node.id || "").toLowerCase();
          const classId = `${className} ${id}`;

          if (/\b(comment|sidebar|footer|nav-box|widget|related|recommend|trending|popular|most.?read|you.?may.?like|advertisement|sponsor|promo|promoted|cookie|consent|gdpr|newsletter|subscribe|sign.?up|share|social|popup|modal|overlay|paywall|banner-ad)\b/.test(classId)) {
            return true;
          }

          return false;
        }

        function scanAndRemove(node) {
          if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

          const children = Array.from(node.children);
          let removedCount = 0;
          for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            if (findRemovableNode(child)) {
              child.remove();
              removedCount++;
            }
          }

          for (let maxPasses = 0; maxPasses < 3; maxPasses++) {
            let removed = false;
            for (const child of Array.from(node.children)) {
              if (isLikelyBoilerplate(child)) {
                child.remove();
                removed = true;
              }
            }
            if (!removed) break;
          }

          for (const child of Array.from(node.children)) {
            scanAndRemove(child);
          }
        }

        scanAndRemove(clone);
        return clone;
      }

      function renderNode(node, listDepth) {
        if (node.nodeType === Node.TEXT_NODE) {
          return clean(node.textContent);
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return "";
        }

        const tag = node.tagName;
        const depth = listDepth || 0;

        if (HEADING_TAGS.has(tag)) {
          const level = Math.min(Number(tag.slice(1)) + 1, 6);
          const headingText = clean(node.textContent);
          return headingText ? `\n\n${"#".repeat(level)} ${headingText}\n\n` : "";
        }

        if (tag === "A") {
          const href = node.getAttribute("href") || "";
          const linkText = clean(node.textContent);
          if (!linkText) return "";
          const fullUrl = href.startsWith("http") || href.startsWith("/") || href.startsWith("#") ? href : "";
          if (fullUrl && fullUrl !== linkText) {
            return `[${linkText}](${fullUrl})`;
          }
          return linkText;
        }

        if (tag === "IMG") {
          const alt = node.getAttribute("alt") || "";
          const src = node.getAttribute("src") || "";
          if (alt || src) {
            return `![${alt}](${src})`;
          }
          return "";
        }

        if (tag === "BR") {
          return "\n";
        }

        if (tag === "HR") {
          return "\n\n---\n\n";
        }

        if (tag === "STRONG" || tag === "B") {
          const text = clean(node.textContent);
          return text ? `**${text}**` : "";
        }

        if (tag === "EM" || tag === "I") {
          const text = clean(node.textContent);
          return text ? `*${text}*` : "";
        }

        if (tag === "U" || tag === "INS") {
          const text = clean(node.textContent);
          return text ? text : "";
        }

        if (tag === "S" || tag === "DEL") {
          const text = clean(node.textContent);
          return text ? `~~${text}~~` : "";
        }

        if (tag === "CODE" && node.closest("pre") === null) {
          const text = clean(node.textContent);
          return text ? `\`${text}\`` : "";
        }

        if (tag === "PRE") {
          const codeEl = node.querySelector("code");
          let language = "";
          if (codeEl) {
            const cls = codeEl.className || "";
            const match = cls.match(/language-(\w+)/);
            if (match) language = match[1];
          }
          const codeText = (codeEl || node).textContent || "";
          if (codeText.trim()) {
            return `\n\n\`\`\`${language}\n${codeText.trim()}\n\`\`\`\n\n`;
          }
          return "";
        }

        if (tag === "BLOCKQUOTE") {
          const quoteLines = (node.textContent || "").trim().split("\n");
          return `\n\n${quoteLines.map((line) => `> ${line.trim()}`).join("\n")}\n\n`;
        }

        if (tag === "LI") {
          const isOrdered = node.closest("ol") !== null;
          const prefix = isOrdered ? "1. " : "- ";
          const indent = "  ".repeat(depth);
          const itemText = clean(node.textContent);
          return itemText ? `${indent}${prefix}${itemText}\n` : "";
        }

        if (tag === "TD" || tag === "TH") {
          return `${clean(node.textContent)} | `;
        }

        if (tag === "TABLE") {
          const rows = [];
          const headerCells = [];
          const thead = node.querySelector("thead");
          if (thead) {
            for (const th of thead.querySelectorAll("th")) {
              headerCells.push(escapeMdTable(th.textContent));
            }
          } else {
            const firstRow = node.querySelector("tr");
            if (firstRow) {
              const thCells = firstRow.querySelectorAll("th");
              if (thCells.length > 0) {
                for (const th of thCells) {
                  headerCells.push(escapeMdTable(th.textContent));
                }
              } else {
                const tdCells = firstRow.querySelectorAll("td");
                for (const td of tdCells) {
                  headerCells.push(escapeMdTable(td.textContent));
                }
              }
            }
          }

          if (headerCells.length) {
            rows.push(`| ${headerCells.join(" | ")} |`);
            rows.push(`| ${headerCells.map(() => "---").join(" | ")} |`);
          }

          const bodyRows = node.querySelectorAll("tbody tr, tr:not(:first-child)");
          const startRow = thead || headerCells.length ? 0 : 1;
          const allRows = node.querySelectorAll("tr");
          for (let i = startRow; i < allRows.length; i++) {
            const row = allRows[i];
            if (row.closest("thead")) continue;
            const cells = [];
            for (const cell of row.querySelectorAll("td, th")) {
              cells.push(escapeMdTable(cell.textContent));
            }
            if (cells.length) {
              rows.push(`| ${cells.join(" | ")} |`);
            }
          }

          return rows.length ? `\n\n${rows.join("\n")}\n\n` : "";
        }

        if (tag === "UL" || tag === "OL") {
          const items = [];
          for (const child of node.children) {
            if (child.tagName === "LI") {
              const nestedLists = Array.from(child.children).filter(
                (c) => c.tagName === "UL" || c.tagName === "OL"
              );
              let ownContent = child.cloneNode(true);
              for (const nl of ownContent.querySelectorAll("ul, ol")) {
                nl.remove();
              }
              const isOrdered = tag === "OL";
              const prefix = isOrdered ? "1. " : "- ";
              const indent = "  ".repeat(depth);
              const itemText = clean(ownContent.textContent);
              if (itemText) {
                items.push(`${indent}${prefix}${itemText}`);
                for (const nested of nestedLists) {
                  items.push(renderNode(nested, depth + 1));
                }
              }
            }
          }
          return items.length ? `\n\n${items.join("\n")}\n\n` : "";
        }

        const renderedChildren = Array.from(node.childNodes)
          .map((child) => renderNode(child, depth))
          .filter(Boolean)
          .join("");

        const rendered = renderedChildren
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n[ \t]+/g, "\n")
          .trim();

        if (!rendered) return "";

        if (BLOCK_TAGS.has(tag)) {
          return `\n\n${rendered}\n\n`;
        }
        return rendered;
      }

      function escapeMdTable(value) {
        return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
      }

      const contentRoot = findContentRoot();
      const cleaned = cleanBoilerplate(contentRoot);

      const title = (document.querySelector("h1") && document.querySelector("h1").textContent || document.title || "Web Page").trim();
      const text = renderNode(cleaned, 0);
      const finalText = text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const metadata = extractMetadata();

      return { title, text: finalText, metadata };
    });

    const text = normalizeText(String(extracted.text || "")).slice(0, MAX_TEXT_CHARS);
    if (text.length < MIN_TEXT_LENGTH) {
      throw new Error("Could not extract readable page content.");
    }

    const finalUrl = page.url() || url;
    await validatePublicHttpUrl(finalUrl);
    const title = normalizeText(String(extracted.title || "Web Page")).slice(0, 180) || "Web Page";
    const metadata = extracted.metadata || {};
    return {
      title,
      url: finalUrl,
      fetchedAt,
      text,
      metadata,
      markdown: buildMarkdown({ title, url: finalUrl, fetchedAt, text, metadata }),
    };
  } finally {
    await browser.close();
  }
}

function buildSessionWebPageDir(sessionId) {
  return path.join(SESSION_WEB_DIR, String(sessionId || "unknown"));
}

function buildSessionWebPagePath(sessionId, pageId, title) {
  const filename = `${slugify(title || "web-page")}-${pageId}.md`;
  return path.join(buildSessionWebPageDir(sessionId), filename);
}

function toRelativePath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

async function saveSessionWebPage({ session, rendered }) {
  const pageId = crypto.randomUUID().slice(0, 8);
  const dir = buildSessionWebPageDir(session.id);
  await fs.mkdir(dir, { recursive: true });

  const filePath = buildSessionWebPagePath(session.id, pageId, rendered.title);
  await fs.writeFile(filePath, rendered.markdown, "utf8");

  const page = {
    id: pageId,
    title: rendered.title,
    url: rendered.url,
    markdownPath: toRelativePath(filePath),
    createdAt: rendered.fetchedAt,
    charCount: rendered.markdown.length,
  };

  session.webPages = Array.isArray(session.webPages) ? session.webPages : [];
  session.webPages.unshift(page);
  session.webPages = session.webPages.slice(0, SESSION_WEB_PAGES_LIMIT);
  return page;
}

async function readSessionWebPageMarkdown(page) {
  if (!page?.markdownPath) {
    return "";
  }
  try {
    return await fs.readFile(path.join(ROOT, page.markdownPath), "utf8");
  } catch {
    return "";
  }
}

function normalizeWebPageSelection(webPageIds = [], webPageId = "") {
  const ids = Array.isArray(webPageIds) ? webPageIds : [];
  const normalized = ids
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  if (!normalized.length && webPageId) {
    normalized.push(String(webPageId).trim());
  }

  return [...new Set(normalized)];
}

async function loadSessionWebPagesWithMarkdown(session, webPageIds = [], webPageId = "") {
  const pages = Array.isArray(session?.webPages) ? session.webPages : [];
  const selectedIds = normalizeWebPageSelection(webPageIds, webPageId);
  const selectedPages = selectedIds.length
    ? selectedIds.map((id) => pages.find((page) => page.id === id)).filter(Boolean)
    : pages;
  const results = [];

  for (const page of selectedPages) {
    const markdown = await readSessionWebPageMarkdown(page);
    if (markdown) {
      results.push({ ...page, markdown });
    }
  }

  return results;
}

async function pruneMissingSessionWebPages(session) {
  const pages = Array.isArray(session.webPages) ? session.webPages : [];
  const valid = [];

  for (const page of pages) {
    const markdown = await readSessionWebPageMarkdown(page);
    if (markdown) {
      valid.push(page);
    }
  }

  const changed = valid.length !== pages.length;
  session.webPages = valid;
  return changed;
}

async function loadSessionWebPageContext(session) {
  const pages = Array.isArray(session?.webPages) ? session.webPages : [];
  const blocks = [];

  for (const page of pages) {
    const markdown = await readSessionWebPageMarkdown(page);
    if (!markdown) {
      continue;
    }
    blocks.push([
      `### Session web page: ${escapeMarkdown(page.title || page.url || page.id)}`,
      `Source URL: ${page.url || ""}`,
      markdown,
    ].join("\n"));
  }

  return truncateToTokenBudget(blocks.join("\n\n---\n\n"), WEB_CONTEXT_TOKEN_BUDGET);
}

async function deleteSessionWebPage(session, pageId, { deleteFile = false } = {}) {
  const pages = Array.isArray(session.webPages) ? session.webPages : [];
  const page = pages.find((item) => item.id === pageId);
  if (!page) {
    return false;
  }

  if (deleteFile && page.markdownPath) {
    await fs.rm(path.join(ROOT, page.markdownPath), { force: true });
  }
  session.webPages = pages.filter((item) => item.id !== pageId);
  return true;
}

module.exports = {
  renderWebPageToMarkdown,
  saveSessionWebPage,
  readSessionWebPageMarkdown,
  normalizeWebPageSelection,
  loadSessionWebPagesWithMarkdown,
  pruneMissingSessionWebPages,
  loadSessionWebPageContext,
  deleteSessionWebPage,
};
