import fs from 'node:fs'
import path from 'node:path'

// Copy the built plugin into a vault: node install.mjs <path to vault>
const vault = process.argv[2]
if (!vault || !fs.existsSync(path.join(vault, '.obsidian'))) {
  console.error('usage: npm run install-vault -- <path to an Obsidian vault>')
  process.exit(1)
}
const target = path.join(vault, '.obsidian', 'plugins', 'pentimento')
fs.mkdirSync(target, { recursive: true })
for (const f of ['main.js', 'manifest.json', 'styles.css']) fs.copyFileSync(f, path.join(target, f))
console.log(`installed into ${target}`)
console.log('In Obsidian: Settings → Community plugins → reload the list, then enable Pentimento.')
