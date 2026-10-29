// Persist UI state under Electron's user profile, independent of the local HTTP port.
// Arayüz durumunu yerel HTTP portundan bağımsız olarak Electron kullanıcı profilinde sakla.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const writeQueues = new Map();

function serialize(file, operation) {
  const previous = writeQueues.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  writeQueues.set(file, next.catch(() => {}));
  return next;
}

export async function readStateFile(file) {
  await (writeQueues.get(file) || Promise.resolve());
  try {
    return { initialized: true, value: JSON.parse(await readFile(file, "utf8")) };
  } catch (error) {
    if (error.code === "ENOENT") return { initialized: false, value: null };
    throw error;
  }
}

export function writeStateFile(file, value) {
  return serialize(file, async () => {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  });
}
