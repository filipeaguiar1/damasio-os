import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const partsDir=path.join(root,"assets","mobile-opening");
const outDir=path.join(root,"public","brand");
const webOut=path.join(outDir,"4ever-seasons-opening-image-summer.mp4");
const legacyNativeOut=path.join(outDir,"4ever-seasons-opening-native-cache-v2.mp4");
const expectedSha256="b9d8477defcef7bdb69203a21402ff60bc74624e67ceb18631453b0087ba0380";
const legacyNativeTargetBytes=160000;

fs.mkdirSync(outDir,{recursive:true});
const parts=fs.readdirSync(partsDir)
  .filter(name=>/^summer\.part\d+\.bin$/.test(name))
  .sort();

if(parts.length!==17){
  throw new Error(`Expected 17 mobile opening parts, got ${parts.length}`);
}

const payload=Buffer.concat(parts.map(name=>fs.readFileSync(path.join(partsDir,name))));
if(payload.length!==37960){
  throw new Error(`Unexpected mobile opening size: ${payload.length}`);
}

const digest=crypto.createHash("sha256").update(payload).digest("hex");
if(digest!==expectedSha256){
  throw new Error(`Mobile opening checksum mismatch: ${digest}`);
}

fs.writeFileSync(webOut,payload);

// APK 52.1.5 only accepts remote startup files above 100 KB. Keep the exact
// same 3-second MP4, then append a valid ISO-BMFF `free` box so the legacy APK
// replaces its bundled/cached old video without changing playback content.
const freeBoxSize=legacyNativeTargetBytes-payload.length;
if(freeBoxSize<8){
  throw new Error(`Legacy native padding is too small: ${freeBoxSize}`);
}
const freeBox=Buffer.alloc(freeBoxSize);
freeBox.writeUInt32BE(freeBoxSize,0);
freeBox.write("free",4,4,"ascii");
const legacyNativePayload=Buffer.concat([payload,freeBox]);
fs.writeFileSync(legacyNativeOut,legacyNativePayload);

console.log(`materialized mobile opening: ${webOut} (${payload.length} bytes)`);
console.log(`materialized legacy native cache: ${legacyNativeOut} (${legacyNativePayload.length} bytes)`);
