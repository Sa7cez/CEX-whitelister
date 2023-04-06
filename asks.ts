import inquirer from 'inquirer'

const questions = {
  BYBIT: [
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
  ],
  OKX: [
    {
      name: 'direction',
      type: 'list',
      message: 'Choose direction:',
      choices: [
        'ETH-ERC20',
        'ETH-Arbitrum one',
        'ETH-zkSync Lite',
        'ETH-Optimism',
        'USDC-Optimism',
        'USDC-Arbitrum one',
        'USDC-Polygon',
        'USDT-Optimism',
        'USDT-Arbitrum one',
        'USDT-Polygon',
        'MATIC-Polygon'
      ],
      default: 'ETH-Arbitrum one'
    },
    {
      name: 'remark',
      type: 'string',
      message: `Input remark for added addresses:`,
      default: 'Batch ' + Date.now()
    },
    {
      name: 'show',
      type: 'confirm',
      message: `Show browser?`,
      default: false
    }
  ]
}

class Ask {
  async askPlatform(platforms) {
    const answers = await inquirer.prompt([
      {
        name: 'platform',
        type: 'list',
        message: `Select CEX:`,
        choices: platforms,
        default: 'OKX'
      }
    ])
    return answers.platform
  }

  async askSettings(platform) {
    return await inquirer.prompt(questions[platform])
  }
}

export default Ask
