// Snapshots PlatformIO's board definitions into the app, for when `pio` isn't installed.
// Usage: pio boards --json-output | node scripts/boards.mjs
import { writeFileSync } from "node:fs"

const input = await new Response(process.stdin).text()
const keep = new Set(["espressif32", "raspberrypi", "atmelsam"])
const boards = JSON.parse(input)
  .filter(b => keep.has(b.platform) && b.frameworks.includes("arduino") && b.ram >= 64 * 1024)
  .map(({ id, name, mcu, fcpu, ram, rom, vendor, url, platform }) => ({
    id,
    name,
    mcu,
    fcpu,
    ram,
    rom,
    vendor,
    url,
    platform,
  }))
  .sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(
  new URL("../src/entities/board/config/boards.json", import.meta.url),
  JSON.stringify(boards),
)
console.log(`${boards.length} boards`)
