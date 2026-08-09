import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const partsDir=path.join(root,"assets","mobile-opening");
const outDir=path.join(root,"public","brand");
const out=path.join(outDir,"4ever-seasons-opening-image-summer.mp4");
const expectedSha256="b9d8477defcef7bdb69203a21402ff60bc74624e67ceb18631453b0087ba0380";

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

fs.writeFileSync(out,payload);
console.log(`materialized mobile opening: ${out} (${payload.length} bytes)`);
