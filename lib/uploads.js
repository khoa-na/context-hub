const Busboy = require("busboy");
const { MAX_UPLOAD_BYTES } = require("../constants");
const { repairTextEncoding } = require("./markdown");

async function parseMultipartFile(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: MAX_UPLOAD_BYTES,
      },
    });

    let uploadedFile = null;
    let filePromise = null;

    busboy.on("file", (_fieldname, file, info) => {
      if (uploadedFile || filePromise) {
        file.resume();
        return;
      }

      const chunks = [];
      const filename = repairTextEncoding(info?.filename || "upload.bin");
      const mimeType = info?.mimeType || "application/octet-stream";

      filePromise = new Promise((fileResolve, fileReject) => {
        file.on("data", (chunk) => {
          chunks.push(chunk);
        });

        file.on("limit", () => {
          fileReject(new Error(`File is too large. Maximum upload size is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`));
        });

        file.on("end", () => {
          fileResolve({
            filename,
            mimeType,
            buffer: Buffer.concat(chunks),
          });
        });

        file.on("error", fileReject);
      });

      filePromise
        .then((result) => {
          uploadedFile = result;
        })
        .catch(reject);
    });

    busboy.on("error", reject);
    busboy.on("filesLimit", () => reject(new Error("Only one file can be uploaded at a time.")));
    busboy.on("close", async () => {
      try {
        if (filePromise) {
          await filePromise;
        }

        if (!uploadedFile || !uploadedFile.buffer.length) {
          reject(new Error("No file was uploaded."));
          return;
        }

        resolve(uploadedFile);
      } catch (error) {
        reject(error);
      }
    });

    req.pipe(busboy);
  });
}

module.exports = {
  parseMultipartFile,
};
