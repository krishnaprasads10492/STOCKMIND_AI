#!/usr/bin/env node
/**
 * StockMind AI — Add User Script
 *
 * Use this to create users directly from the terminal without needing
 * the web app running. Useful for first-time setup.
 *
 * Usage:
 *   node server/keygen/addUser.js
 *
 * Or with npm:
 *   npm run adduser
 *
 * You will be prompted for:
 *   - Data folder password
 *   - Username
 *   - Password
 *   - Role (admin / user / super-admin)
 */

import readline from 'readline'
import { initEncryption } from '../storage/fileStore.js'
import { createUser, getUserByUsername } from '../services/authService.js'

function ask(rl, question, hidden = false) {
  return new Promise(resolve => {
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question)
      process.stdin.setRawMode(true)
      process.stdin.resume()
      let input = ''
      process.stdin.on('data', function handler(ch) {
        ch = ch.toString()
        if (ch === '\n' || ch === '\r' || ch === '\u0003') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.removeListener('data', handler)
          process.stdout.write('\n')
          resolve(input)
        } else if (ch === '\u007f') {
          input = input.slice(0, -1)
        } else {
          input += ch
          process.stdout.write('*')
        }
      })
    } else {
      rl.question(question, resolve)
    }
  })
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  console.log('\n╔══════════════════════════════════════╗')
  console.log('║   StockMind AI — Add User            ║')
  console.log('╚══════════════════════════════════════╝\n')

  const dataPassword = await ask(rl, 'Data folder password: ', true)
  initEncryption(dataPassword)

  const username = (await ask(rl, 'Username (lowercase, 4-32 chars): ')).trim().toLowerCase()
  if (!username || username.length < 4) {
    console.error('Username must be at least 4 characters.')
    rl.close(); process.exit(1)
  }

  if (getUserByUsername(username)) {
    console.error(`User "${username}" already exists.`)
    rl.close(); process.exit(1)
  }

  const password = await ask(rl, 'Password (min 8 chars): ', true)
  if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters.')
    rl.close(); process.exit(1)
  }

  const roleInput = (await ask(rl, 'Role [user/admin/super-admin] (default: user): ')).trim().toLowerCase()
  const role = ['admin', 'super-admin'].includes(roleInput) ? roleInput : 'user'

  rl.close()

  console.log('\nCreating user...')
  const result = await createUser({ username, password, role }, 'cli')

  if (!result.ok) {
    console.error('Failed:', result.error)
    process.exit(1)
  }

  console.log('\n✅ User created successfully!')
  console.log(`   Username : ${username}`)
  console.log(`   Role     : ${role}`)
  console.log(`   User ID  : ${result.userId}`)
  console.log('\nNext step — generate the 12-digit access key:')
  console.log(`   npm run keygen -- --user ${username}\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
