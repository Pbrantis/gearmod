import { describe, expect, it } from 'vitest'
import { explainCommand, shortPath, splitCommand } from './permissionExplain'

const sample = 'cd "C:/Users/dev/AppData/Roaming/@gearmod/desktop/data/wt/2e84d10e/3-shop-checkout-flow" && sed -n 380,392p core/settings.py; grep -rn "\\.delay(" api --include=*.py | grep -v "/tests/" | head -5; grep -n "from core.celery\\|import app" api/tasks.py core/*.py | head'

describe('permission request explanation', () => {
  it('splits on &&, ; and pipes without breaking quoted text', () => {
    expect(splitCommand('echo "a && b" && ls | wc').map((part) => part.text)).toEqual(['echo "a && b"', 'ls', 'wc'])
  })
  it('shortens the worktree path of the card', () => {
    expect(shortPath('C:/Users/x/AppData/Roaming/@gearmod/desktop/data/wt/2e84d10e/3-shop-checkout-flow/core/a.py')).toBe('worktree/3-shop-checkout-flow/core/a.py')
  })
  it('maps the example read command into readable, read-only steps', () => {
    const { steps, risk } = explainCommand(sample)
    expect(risk).toBe('read')
    expect(steps.map((step) => step.label)).toEqual(['Entrar na pasta', 'Ler linhas 380–392', 'Buscar texto', 'Buscar texto', 'Mostrar só o início (5 linhas)', 'Buscar texto', 'Mostrar só o início'])
    expect(steps[0]!.detail).toBe('worktree/3-shop-checkout-flow')
    expect(steps[1]!.detail).toBe('core/settings.py')
  })
  it('flags delete, git commit, sed -i and redirection as changes, but not 2>/dev/null', () => {
    expect(explainCommand('rm -rf build').risk).toBe('write')
    expect(explainCommand('git commit -m x').risk).toBe('write')
    expect(explainCommand('git status && git log -3').risk).toBe('read')
    expect(explainCommand("sed -i 's/a/b/' x.txt").risk).toBe('write')
    expect(explainCommand('echo oi > a.txt').risk).toBe('write')
    expect(explainCommand('ls 2>/dev/null').risk).toBe('read')
    expect(explainCommand('pnpm test').risk).toBe('other')
  })
})
