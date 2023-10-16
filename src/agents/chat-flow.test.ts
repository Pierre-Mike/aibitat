import {beforeEach, describe, expect, mock, test} from 'bun:test'
import OpenAI from 'openai'

import {AIProvider} from '../providers'
import {type Message} from '../types.ts'
import {AIbitat, type AIbitatProps} from './chat-flow.ts'

// HACK: Mock the AI provider.
// This is still needed because Bun doesn't support mocking modules yet.
// Neither mocking the HTTP requests.
export const ai = {
  create: mock((messages: Message[]) => {}),
}
const provider = ai as unknown as AIProvider<OpenAI>

beforeEach(() => {
  ai.create.mockClear()
  ai.create.mockImplementation(() => Promise.resolve('TERMINATE'))
})

const defaulthabitat: AIbitatProps = {
  provider,
  nodes: {
    '🧑': '🤖',
  },
  config: {
    '🧑': {type: 'assistant'},
    '🤖': {type: 'agent'},
  },
}

const defaultStart = {
  from: '🧑',
  to: '🤖',
  content: '2 + 2 = 4?',
}

describe('direct message', () => {
  test('should reply a chat', async () => {
    const habitat = new AIbitat(defaulthabitat)
    await habitat.start(defaultStart)

    expect(habitat.chats).toHaveLength(2)
    // expect human has the TERMINATE from the bot
    expect(habitat.chats.at(-1)).toEqual({
      from: '🤖',
      to: '🧑',
      content: 'TERMINATE',
      state: 'success',
    })
  })

  test('should have a system message', async () => {
    const role = 'You are a 🤖.'

    const habitat = new AIbitat({
      ...defaulthabitat,
      config: {
        ...defaulthabitat.config,
        '🤖': {type: 'agent', role},
      },
    })

    await habitat.start(defaultStart)

    expect(ai.create).toHaveBeenCalledTimes(1)
    expect(ai.create.mock.calls[0][0][0].content).toEqual(role)
  })

  test('should keep chatting util its task is done', async () => {
    let i = 0
    ai.create.mockImplementation(() =>
      Promise.resolve(i >= 10 ? 'TERMINATE' : `... ${i++}`),
    )

    const habitat = new AIbitat({
      ...defaulthabitat,
      config: {
        ...defaulthabitat.config,
        '🧑': {type: 'assistant', interrupt: 'NEVER'},
      },
    })

    await habitat.start(defaultStart)

    // the chat gets in a loop if the bot doesn't terminate
    expect(habitat.chats).toHaveLength(12)
  })

  test('should not engage in infinity conversations', async () => {
    ai.create.mockImplementation(() => Promise.resolve('...'))

    const habitat = new AIbitat({
      ...defaulthabitat,
      maxRounds: 4,
      config: {
        ...defaulthabitat.config,
        '🧑': {type: 'assistant', interrupt: 'NEVER'},
      },
    })

    await habitat.start(defaultStart)

    expect(ai.create).toHaveBeenCalledTimes(3)
  })

  test('should have initial messages', async () => {
    const habitat = new AIbitat({
      ...defaulthabitat,
      maxRounds: 1,
      chats: [
        {
          from: '🧑',
          to: '🤖',
          content: '2 + 2 = 4?',
          state: 'success',
        },
      ],
    })

    await habitat.start({
      from: '🤖',
      to: '🧑',
      content: '4',
    })

    expect(habitat.chats).toHaveLength(3)
    expect(habitat.chats.at(0)).toEqual({
      from: '🧑',
      to: '🤖',
      content: '2 + 2 = 4?',
      state: 'success',
    })
  })

  test('should trigger an event when a reply is received', async () => {
    const habitat = new AIbitat(defaulthabitat)

    const callback = mock(() => {})
    habitat.on('message', callback)

    await habitat.start(defaultStart)

    expect(callback).toHaveBeenCalledTimes(2)
  })

  test('should always interrupt interaction after each reply', async () => {
    ai.create.mockImplementation(() => Promise.resolve('...'))

    const habitat = new AIbitat({
      ...defaulthabitat,
      interrupt: 'ALWAYS',
    })

    const callback = mock(() => {})
    habitat.on('interrupt', callback)

    await habitat.start(defaultStart)

    expect(callback).toHaveBeenCalledTimes(1)
  })

  test('should trigger an event when a interaction is needed', async () => {
    ai.create.mockImplementation(() => Promise.resolve('...'))

    const habitat = new AIbitat({
      ...defaulthabitat,
      config: {
        ...defaulthabitat.config,
        '🤖': {type: 'agent', interrupt: 'ALWAYS'},
      },
    })

    const callback = mock(() => {})
    habitat.on('interrupt', callback)

    await habitat.start(defaultStart)

    expect(habitat.chats).toHaveLength(3)
  })

  test('should auto-reply only when user skip engaging', async () => {
    ai.create.mockImplementation(() => Promise.resolve('...'))

    const habitat = new AIbitat(defaulthabitat)
    // HACK: we should use `expect.assertions(1)` here but
    // bun has not implemented it yet.
    // so I have to work around it.
    // https://github.com/oven-sh/bun/issues/1825
    const p = new Promise(async resolve => {
      habitat.on('interrupt', async () => {
        if (habitat.chats.length < 4) {
          await habitat.continue()
        } else {
          resolve(true)
        }
      })

      await habitat.start(defaultStart)
    })

    expect(p).resolves.toBeTrue()
    expect(habitat.chats[3].content).toBe('...')
    expect(habitat.chats[3].state).toBe('success')
    expect(habitat.chats).toHaveLength(5)
  })

  test('should continue conversation with user`s feedback', async () => {
    ai.create.mockImplementation(() => Promise.resolve('...'))

    const habitat = new AIbitat({
      ...defaulthabitat,
      maxRounds: 10,
    })

    // HACK: we should use `expect.assertions(1)` here but
    // bun has not implemented it yet.
    // so I have to work around it.
    // https://github.com/oven-sh/bun/issues/1825
    const p = new Promise(async resolve => {
      habitat.on('interrupt', a => {
        if (habitat.chats.length < 4) {
          habitat.continue('my feedback')
        } else {
          resolve(true)
        }
      })

      await habitat.start(defaultStart)
    })

    expect(p).resolves.toBeTrue()
    expect(habitat.chats[2].from).toBe('🧑')
    expect(habitat.chats[2].to).toBe('🤖')
    expect(habitat.chats[2].content).toBe('my feedback')
  })
})

describe('as a group', () => {
  const grouphabitat: AIbitatProps = {
    ...defaulthabitat,
    nodes: {
      '🧑': '🤖',
      '🤖': ['🐶', '😸', '🐭'],
    },
    config: {
      '🧑': {type: 'assistant'},
      '🤖': {type: 'manager', provider},
      '🐶': {type: 'agent'},
      '😸': {type: 'agent'},
      '🐭': {type: 'agent'},
    },
  }

  beforeEach(() => {
    ai.create.mockImplementation(x => {
      const roleMessage = x.find(y => y.content?.includes('next role'))

      if (roleMessage) {
        // pick a random node from grouphabitat.nodes
        const nodes = grouphabitat.nodes['🤖']
        const nextRole = nodes[Math.floor(Math.random() * nodes.length)]
        return Promise.resolve(nextRole)
      }

      return Promise.resolve('...')
    })
  })

  test('should chat to members of the group', async () => {
    const habitat = new AIbitat(grouphabitat)
    await habitat.start(defaultStart)

    expect(habitat.chats).toHaveLength(11)
  })

  test.todo('should infer the next speaker', async () => {})

  test('should chat only a specific amount of rounds', async () => {
    const habitat = new AIbitat({
      ...grouphabitat,
      config: {
        ...grouphabitat.config,
        '🤖': {type: 'manager', provider, maxRounds: 4},
      },
    })
    await habitat.start(defaultStart)

    expect(habitat.chats).toHaveLength(5)
  })
})

test.todo('should call a function', async () => {
  const myFunc = mock((props: {x: number; y: number}) => {})

  const habitat = new AIbitat({
    ...defaulthabitat,
  })
  await habitat.start(defaultStart)

  expect(myFunc).toHaveBeenCalledTimes(1)
  expect(myFunc.mock.calls[0][0]).toEqual({x: 1, y: 2})
})

test.todo('should execute code', async () => {})
