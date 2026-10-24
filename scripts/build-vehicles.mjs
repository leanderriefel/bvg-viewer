/** Build the original fleet in the running Blender Lab add-on (loopback TCP). */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = fileURLToPath(
  new URL("blender/build_vehicles.py", import.meta.url)
);
const script = await readFile(scriptPath, "utf-8");
const code = [
  `scope = {"__name__": "berlin_vehicle_asset_builder", "__file__": ${JSON.stringify(scriptPath)}}`,
  `exec(compile(${JSON.stringify(script)}, ${JSON.stringify(scriptPath)}, "exec"), scope)`,
  `result = scope["build_pack"](${JSON.stringify(root)})`,
].join("\n");

const response = await new Promise((resolve, reject) => {
  const connection = createConnection({ host: "127.0.0.1", port: 9876 });
  const chunks = [];
  let size = 0;
  let settled = false;
  const fail = (error) => {
    if (!settled) {
      settled = true;
      connection.destroy();
      reject(error);
    }
  };
  connection.setTimeout(600_000, () => {
    fail(new Error("Blender vehicle build timed out after ten minutes."));
  });
  connection.on("error", (error) => {
    fail(
      new Error(
        `Cannot use the Blender bridge at 127.0.0.1:9876. Open Blender and start the Blender Lab MCP add-on server. ${error.message}`,
        { cause: error }
      )
    );
  });
  connection.on("connect", () => {
    connection.write(
      `${JSON.stringify({ type: "execute", code, strict_json: true })}\0`
    );
  });
  connection.on("data", (chunk) => {
    chunks.push(chunk);
    size += chunk.length;
    if (size > 8 * 1024 * 1024) {
      fail(new Error("Blender returned an unexpectedly large build response."));
      return;
    }
    const content = Buffer.concat(chunks);
    const end = content.indexOf(0);
    if (end === -1) {
      return;
    }
    try {
      const parsed = JSON.parse(content.subarray(0, end).toString("utf-8"));
      settled = true;
      connection.end();
      resolve(parsed);
    } catch (error) {
      fail(new Error("Blender returned invalid JSON.", { cause: error }));
    }
  });
  connection.on("end", () => {
    if (!settled) {
      fail(new Error("Blender closed the bridge without a complete response."));
    }
  });
});

if (response.status !== "ok") {
  throw new Error(
    response.message ?? "Blender failed to build the vehicle pack."
  );
}
const runFile = promisify(execFile);
const finalizeScript = fileURLToPath(
  new URL("blender/finalize_vehicles.py", import.meta.url)
);
await runFile(
  response.result.blenderExecutable,
  [
    "--background",
    response.result.blendFile,
    "--python",
    finalizeScript,
    "--",
    response.result.blendFile,
  ],
  { windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 }
);
process.stdout.write(`${JSON.stringify(response.result, null, 2)}\n`);
