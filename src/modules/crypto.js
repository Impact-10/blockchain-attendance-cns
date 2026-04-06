const crypto = require("crypto");

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateAttendanceCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let output = "";
  for (let i = 0; i < length; i += 1) {
    const index = crypto.randomInt(0, alphabet.length);
    output += alphabet[index];
  }
  return output;
}

function generateNonce(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function canonicalPayload({ student_id, keyword, timestamp, nonce, location }) {
  const safeLocation = {
    lat: Number(location.lat),
    lon: Number(location.lon)
  };

  return JSON.stringify({
    student_id,
    keyword,
    timestamp,
    nonce,
    location: safeLocation
  });
}

function canonicalSubmissionPayload({ student_id, session_id, keyword, timestamp, nonce }) {
  return JSON.stringify({
    student_id,
    session_id,
    keyword,
    timestamp,
    nonce
  });
}

function generateStudentKeyPair() {
  return crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
}

function signHash(hashHex, privateKeyPem) {
  const signature = crypto.sign(null, Buffer.from(hashHex, "hex"), privateKeyPem);
  return signature.toString("base64");
}

function verifyHash(hashHex, signatureBase64, publicKeyPem) {
  return crypto.verify(
    null,
    Buffer.from(hashHex, "hex"),
    publicKeyPem,
    Buffer.from(signatureBase64, "base64")
  );
}

function verifySignedPayload(payload, signatureBase64, publicKeyPem) {
  try {
    const keyObject = crypto.createPublicKey(publicKeyPem);
    const keyType = keyObject.asymmetricKeyType;
    const algorithm = keyType === "ed25519" ? null : "sha256";
    const payloadBuffer = Buffer.from(payload, "utf8");
    const signatureBuffer = Buffer.from(signatureBase64, "base64");

    if (keyType === "ec") {
      const derValid = crypto.verify(
        algorithm,
        payloadBuffer,
        { key: keyObject, dsaEncoding: "der" },
        signatureBuffer
      );

      if (derValid) {
        return true;
      }

      return crypto.verify(
        algorithm,
        payloadBuffer,
        { key: keyObject, dsaEncoding: "ieee-p1363" },
        signatureBuffer
      );
    }

    return crypto.verify(
      algorithm,
      payloadBuffer,
      keyObject,
      signatureBuffer
    );
  } catch {
    return false;
  }
}

module.exports = {
  sha256,
  generateAttendanceCode,
  generateNonce,
  normalizeCode,
  canonicalPayload,
  canonicalSubmissionPayload,
  generateStudentKeyPair,
  signHash,
  verifyHash,
  verifySignedPayload
};
