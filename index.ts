import * as dotenv from 'dotenv'
import authenticator from 'authenticator'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import notifier from 'mail-notifier'
import { Page } from 'playwright'
import fs from 'fs'
import got from 'got'
import Ask from './asks'
import delay from 'delay'

// Settings
dotenv.config()
chromium.use(StealthPlugin())

// Const
const log = console.log,
  ui = new Ask(),
  FILE = 'addresses.txt',
  BYBIT_AUTHENTICATOR = process.env.BYBIT_AUTHENTICATOR || null,
  OKX_AUTHENTICATOR = process.env.OKX_AUTHENTICATOR || null,
  EMAIL_LOGIN = process.env.EMAIL_LOGIN || null,
  EMAIL_PASSWORD = process.env.EMAIL_PASSWORD || null,
  EMAIL_HOST = process.env.EMAIL_HOST || 'imap.gmail.com',
  EMAIL_PORT = process.env.EMAIL_PORT || 993,
  TELEGRAM = process.env.TELEGRAM || null,
  ADMIN = process.env.ADMIN || null

// Initialize email listener
let email = false
const mailClient = notifier({
  user: EMAIL_LOGIN,
  password: EMAIL_PASSWORD,
  host: EMAIL_HOST,
  markSeen: true,
  port: EMAIL_PORT,
  tls: true,
  tlsOptions: { rejectUnauthorized: false }
})
  .on('error', (err) => {
    log('Email connection error:', err.message)
    email = err.message
  })
  .on('connected', () => {
    log('Email successfully connected!')
    email = true
  })
  .start()
  .stop()

//  Wait verification code on email
const waitCode = async (subject = 'Bybit', regex = /<strong>(\d{6})<\/strong>/, timeout = 45000, retry = 0) =>
  new Promise<string>((resolve) => {
    log('Wait verification code...')
    setTimeout(() => resolve(null), timeout)
    mailClient
      .on('mail', (mail) => {
        log('Get new email:', mail.subject)
        const links = mail.subject.indexOf(subject) > -1 && (mail.html ? mail.html.match(regex) : null)
        if (links) {
          mailClient.stop()
          resolve(links.pop())
        }
      })
      .start()
      .on('error', async () => {
        retry++
        if (retry < 3) resolve(await waitCode(subject, regex, timeout, retry))
      })
  })

// Get 2fa token
const getToken = (service) => {
  try {
    return authenticator.generateToken(service)
  } catch (e) {
    return false
  }
}

// Fill/refill fields and submit
const submitCredentials = async (page: Page, code: string) => {
  await page.getByPlaceholder('Enter verification code').type(code)
  await page.getByPlaceholder('Enter Google Authenticator code').type(await getToken(BYBIT_AUTHENTICATOR))
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

// Add bybit address
const addBybitAddress = async (page: Page, address: string, settings: any) => {
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

    log('Code:', (code = (await waitCode()) || code))

    if (code) {
      await submitCredentials(page, code)
      await page.waitForTimeout(100)
      return !(await page.isVisible('.ant-modal-content', { timeout: 5000 }))
    }
  }
}

// Add OKX addresses
const fillList = async (list, addresses, remark) => {
  let counter = 0
  for (const element of await list.getByPlaceholder('You can also use a .crypto domain').all())
    if (addresses[counter]) {
      await element.fill(addresses[counter])
      counter++
    }
  if (remark) for (const element of await list.getByPlaceholder('e.g. my wallet').all()) await element.fill(remark)
}

const tryConfirm = async (page, code) => {
  try {
    if (code) await page.getByPlaceholder('Enter email code').fill(code)
    log(`Email code: ${code}`)
    await page.waitForTimeout(200)
    await page.getByText('Authentication app', { exact: true }).click()
    await page.getByPlaceholder('Enter the authentication app code').fill(getToken(OKX_AUTHENTICATOR))
    await page.getByRole('button').filter({ hasText: 'Confirm' }).click()
    return true
  } catch (e) {
    log(e)
    return false
  }
}

const addNewBatchOfAddresses = async (page: Page, addresses, remark) => {
  await page.goto('https://www.okx.com/balance/withdrawal-address/eth/2', {
    waitUntil: 'domcontentloaded'
  })
  await page.getByRole('button').filter({ hasText: 'Add a new address' }).click()

  for (let i = 0; i < addresses.length - 1; i++) await page.getByText('Add address', { exact: true }).click()
  await fillList(page, addresses, remark)
  for (const element of await page.getByRole('checkbox').all()) await element.check()

  await page.getByText('Send code', { exact: true }).first().click()
  const code = await waitCode('verification code', /(\d{6})<\/div>/, 60000)
  return await tryConfirm(page, code)
}

const getAddresses = async () =>
  [
    ...new Set(
      await fs.promises
        .readFile(FILE, 'utf-8')
        .then((addresses) => [...new Set(addresses.split('\n').filter((item) => item.length > 0))])
        .catch(() => [])
    )
  ].map((address) => address.toLowerCase().replace('\r', ''))

const main = async () => {
  let addresses = await getAddresses()
  if (addresses.length === 0) return log(`Please fill file ${FILE}`)
  else log(`\nFound ${addresses.length} addresses to add!\n`)

  const OKX = getToken(OKX_AUTHENTICATOR)
  const BYBIT = getToken(BYBIT_AUTHENTICATOR)

  let platforms = []
  if (OKX) platforms.push('OKX')
  if (BYBIT) platforms.push('BYBIT')

  await delay(3000)

  log('Check credentials:\n')
  log('  OKX 2fa token:', OKX, OKX ? 'OK' : 'add OKX_AUTHENTICATOR to enviroments if you need it!')
  log('  BYBIT 2fa token:', BYBIT, BYBIT ? 'OK' : 'add BYBIT_AUTHENTICATOR to enviroments if you need it!')
  log('  Email connection:', email, '\n')

  if (email !== true || platforms.length === 0) return log('\nPlease check provided credentials!')

  let platform = await ui.askPlatform(platforms)
  let settings = await ui.askSettings(platform)
  if (platform === 'BYBIT') settings.show = true

  const sessionExisted = fs.existsSync(`${platform}.json`)
  const browser = await chromium.launch({
    headless: !settings.show,
    args: ['--disable-web-security', '--start-fullscreen']
  })
  const context = await browser.newContext({ storageState: `${platform}.json` }).catch(() =>
    browser.newContext({
      locale: 'en_US'
    })
  )
  const page = await context.newPage()

  if (!sessionExisted) {
    if (platform === 'OKX') {
      await page.goto('https://www.okx.com/account/login')
      await page.getByRole('button').filter({ hasText: 'Accept All Cookies' }).click()
      await page.getByText('QR code').click({ force: true })
      await page.waitForSelector('.qr-container-v2')
      await page.waitForSelector('.verify-code-module')
      const code = getToken(OKX_AUTHENTICATOR)
      await page.keyboard.type(code)
      await page.getByRole('button').filter({ hasText: 'Next' }).click()
      await page.waitForURL('https://www.okx.com/account/users', {
        timeout: 180000
      })
    } else {
      await page.goto('https://www.bybit.com/login')
      await page.waitForURL('https://www.bybit.com/en-US/dashboard', {
        timeout: 180000
      })
    }
    await context.storageState({ path: `${platform}.json` })
    log('Session successfully created and saved!')
    await page.waitForTimeout(3000)
  }

  switch (platform) {
    case 'OKX':
      // Filter already added addresses
      page.on('response', async (response) => {
        if (response.url().indexOf('withdraw/address-by-type') > -1) {
          const added = (await response.json()).data.addressList.map((i) => i.address.toLowerCase())
          log(`You have ${added.length} addresses in OKX whitelist!`)
          await fs.promises.writeFile(`added-${platform}.txt`, added.join('\n'))
          addresses = addresses.filter((address) => !added.includes(address))
          log(`Estimate ${addresses.length} new addresses to add!\n`)
        }
      })
      await page.goto('https://www.okx.com/balance/withdrawal-address/eth/2', {
        waitUntil: 'networkidle'
      })

      // Processing
      while (addresses.length > 0) {
        try {
          const batch = addresses.slice(0, 20)
          await addNewBatchOfAddresses(page, batch, settings.remark)
          await page.waitForTimeout(60000)
        } catch (e) {
          log(e, 'Something wrong, retry')
        }
      }
      break

    case 'BYBIT':
      await page.goto('https://www.bybit.com/user/assets/money-address', {
        waitUntil: 'domcontentloaded'
      })

      for (const address of addresses) {
        const result = await addBybitAddress(page, address, settings)
        if (result) {
          addresses = addresses.filter((item) => item.toLowerCase() !== address)
          log(`Success, delete key ...${address.slice(-10)} from ${FILE}`)
          await fs.promises.writeFile(FILE, addresses.join('\n'))
        }
        log('Result:', result, `\nWait ${settings.timeout} seconds...\n`)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(settings.timeout * 1000)
      }

      break
    default:
      log('Unsupported platform!')
      break
  }

  log('\nAll addresses processed (no guarantees)')
}

if (!BYBIT_AUTHENTICATOR || !OKX_AUTHENTICATOR) log('Need Google Authentiticator Key to bypass 2fa verifications!')
else if (!EMAIL_LOGIN || !EMAIL_PASSWORD || !EMAIL_HOST || !EMAIL_PORT) log('Need IMAP email settings!')
else main().catch((e) => log(e))
