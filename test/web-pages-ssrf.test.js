const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isPrivateIPv4,
  isPrivateIPv6,
  isPrivateAddress,
  validatePublicHttpUrl,
} = require("../lib/web-pages");

test("isPrivateIPv4 flags private and reserved ranges", () => {
  for (const ip of ["10.0.0.1", "192.168.1.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "0.0.0.0", "224.0.0.1"]) {
    assert.equal(isPrivateIPv4(ip), true, `expected ${ip} private`);
  }
});

test("isPrivateIPv4 allows public addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34"]) {
    assert.equal(isPrivateIPv4(ip), false, `expected ${ip} public`);
  }
});

test("isPrivateIPv6 flags loopback and unique-local/link-local", () => {
  for (const ip of ["::1", "::", "fc00::1", "fd12::1", "fe80::1"]) {
    assert.equal(isPrivateIPv6(ip), true, `expected ${ip} private`);
  }
  assert.equal(isPrivateIPv6("2001:4860:4860::8888"), false);
});

test("isPrivateAddress treats non-IP hostnames as unsafe", () => {
  assert.equal(isPrivateAddress("not-an-ip"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("10.0.0.1"), true);
});

test("validatePublicHttpUrl rejects non-http protocols", async () => {
  await assert.rejects(() => validatePublicHttpUrl("ftp://example.com"), /http and https/);
});

test("validatePublicHttpUrl rejects malformed URLs", async () => {
  await assert.rejects(() => validatePublicHttpUrl("not a url"), /valid http or https/);
});

test("validatePublicHttpUrl rejects localhost", async () => {
  await assert.rejects(() => validatePublicHttpUrl("http://localhost/admin"), /Localhost/);
});

test("validatePublicHttpUrl rejects private IP literals before any DNS lookup", async () => {
  await assert.rejects(() => validatePublicHttpUrl("http://127.0.0.1"), /Private network/);
  await assert.rejects(() => validatePublicHttpUrl("http://10.0.0.5"), /Private network/);
});
