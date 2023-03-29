import * as dotenv from 'dotenv'
import authenticator from 'authenticator'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import notifier from 'mail-notifier'
import { Page } from 'playwright'
import fs from 'fs'
import inquirer from 'inquirer'
import got from 'got'

// Settings
dotenv.config()
chromium.use(StealthPlugin())

// Const
const log = console.log,
  HEADLESS = false,
  FILE = 'addresses.txt',
  AUTHENTICATOR = process.env.AUTHENTICATOR || null,
  EMAIL_LOGIN = process.env.EMAIL_LOGIN || null,
  EMAIL_PASSWORD = process.env.EMAIL_PASSWORD || null,
  EMAIL_HOST = process.env.EMAIL_HOST || 'imap.gmail.com',
  EMAIL_PORT = process.env.EMAIL_PORT || 993,
  TELEGRAM = process.env.TELEGRAM || null,
  ADMIN = process.env.ADMIN || null

// Initialize email listener
const mailClient = notifier({
  user: EMAIL_LOGIN,
  password: EMAIL_PASSWORD,
  host: EMAIL_HOST,
  markSeen: true,
  port: EMAIL_PORT,
  tls: true,
  tlsOptions: { rejectUnauthorized: false }
}).on('error', (err) => log('Email connection error:', err))

//  Wait verification code on email
const waitCode = async () =>
  new Promise<string>((resolve, reject) => {
    log('Wait verification code...')
    setTimeout(() => resolve(null), 45000)
    mailClient
      .on('mail', (mail) => {
        const links = mail.subject.includes('Bybit') && mail.html ? mail.html.match(/<strong>(\d{6})<\/strong>/) : null
        if (links) resolve(links.pop())
      })
      .start()
      .on('error', async () => resolve(await waitCode()))
  })

// Get 2fa token
const getToken = () => authenticator.generateToken(AUTHENTICATOR)

// Fill/refill fields and submit
const submitCredentials = async (page: Page, code: string) => {
  await page.getByPlaceholder('Enter verification code').type(code)
  await page.getByPlaceholder('Enter Google Authenticator code').type(await getToken())
  return await page.getByRole('button').filter({ hasText: 'Submit' }).click()
}

// Telegram notification
const notify = async (message = 'Please back to browser and solve captcha!') =>
  TELEGRAM
    ? got.post('https://api.telegram.org/bot' + TELEGRAM + '/sendMessage', {
        json: {
          chat_id: ADMIN,
          text: message
        }
      })
    : log(message)

const addAddress = async (page: Page, address: string, settings: any) => {
  log('Try to add', address)
  await page.getByLabel('plus').click()
  await page.getByRole('dialog', { name: 'Add' }).locator('#coin').type(settings.blockchain)
  await page.keyboard.press('Enter')
  await page.getByPlaceholder('Please input your withdrawal wallet address').fill(address)
  await page.getByLabel('Chain Type').type(settings.network)
  await page.keyboard.press('Enter')
  if (settings.remark) await page.getByLabel('Remark').type(settings.remark)

  await page.waitForTimeout(100)
  await page.getByRole('checkbox').check()
  await page.getByRole('button').filter({ hasText: 'Confirm' }).click()

  let code = null
  for (;;) {
    await page
      .getByRole('button')
      .filter({ hasText: /(Resend|Get\sCode)/ })
      .click({ timeout: 10000 })
      .catch(() => notify())

    code = (await waitCode()) || code
    if (code) {
      await submitCredentials(page, code)
      await page.waitForTimeout(100)
      return !(await page.isVisible('.ant-modal-content', { timeout: 5000 }))
    }
  }
}

const questions = [
  {
    name: 'blockchain',
    type: 'string',
    message: `Input blockchain name (BTC, ETH or other):`,
    default: 'ETH'
  },
  {
    name: 'network',
    type: 'string',
    message: `Input network first letter(s):`,
    default: 'E'
  },
  {
    name: 'remark',
    type: 'string',
    message: `Input remark for added addresses:`,
    default: 'Batch'
  },
  {
    name: 'timeout',
    type: 'number',
    message: `Input timeout in seconds:`,
    default: 120
  }
]

const getAddresses = async () => [
  ...new Set(
    await fs.promises
      .readFile(FILE, 'utf-8')
      .then((addresses) => addresses.split('\n').filter((item) => item.length > 0))
      .catch(() => [])
  )
]

const main = async () => {
  let addresses = await getAddresses()
  if (addresses.length === 0) return log(`Please fill file ${FILE}`)
  else log(`\nFound ${addresses.length} addresses to add!\n`)
  const settings = await inquirer.prompt(questions)

  const browser = await chromium.launch({ headless: HEADLESS })
  const context = await browser
    .newContext({ storageState: 'state.json' })
    .catch(() => browser.newContext({ locale: 'en_US' }))
  const page = await context.newPage()

  if (!fs.existsSync('state.json')) {
    await page.goto('https://www.bybit.com/login')
    await page.waitForURL('https://www.bybit.com/en-US/dashboard', {
      timeout: 180000
    })
    await context.storageState({ path: 'state.json' })
  }

  await page.goto('https://www.bybit.com/user/assets/money-address', {
    waitUntil: 'domcontentloaded'
  })
  await page.waitForTimeout(3000)

  for (const address of addresses) {
    const result = await addAddress(page, address, settings)
    if (result) {
      addresses = addresses.filter((item) => item !== address)
      log(`Success, delete key ...${address.slice(-10)} from ${FILE}`)
      await fs.promises.writeFile(FILE, addresses.join('\n'))
    }
    log('Result:', result, `\nWait ${settings.timeout} seconds...\n`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(settings.timeout * 1000)
  }
}

if (!AUTHENTICATOR) log('Need Google Authentiticator Bybit Key to bypass 2fa verification!')
else if (!EMAIL_LOGIN || !EMAIL_PASSWORD || !EMAIL_HOST || !EMAIL_PORT) log('Need IMAP email settings!')
else main().catch((e) => log(e))
