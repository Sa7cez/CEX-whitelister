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
      name: 'type',
      type: 'list',
      message: 'Choose address type:',
      choices: ['Universal address', 'EVM address', 'Delete addresses'],
      default: 'EVM address'
    },
    {
      name: 'direction',
      type: 'list',
      message: 'Choose network:',
      choices: ['ETH-ERC20', 'ETH-StarkNet'],
      default: 'ETH-ERC20'
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

  async askMode(platform) {
    const answers = await inquirer.prompt([
      {
        name: 'platform',
        type: 'list',
        message: `Choose mode:`,
        choices: [
          {
            name: 'Add addresses',
            value: 'add'
          },
          {
            name: 'Add subbaccounts',
            value: 'subaccounts'
          }
        ],
        default: 'add'
      }
    ])
    return answers.platform
  }
}

export default Ask
