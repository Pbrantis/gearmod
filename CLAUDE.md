# GearMod

## Build

Nao gere o build ao terminar tasks. So rode o build quando o usuario pedir. Quando pedir, rode na raiz do projeto:

```powershell
# Build rápido: executável para testar, sem gerar instalador.
powershell -ExecutionPolicy Bypass -File .\build.ps1

# Build de distribuição: instalador NSIS.
powershell -ExecutionPolicy Bypass -File .\installer.ps1
```

- `build.ps1` instala dependências, gera `apps/desktop/dist/win-unpacked/GearMod.exe` e imprime seu caminho e hora.
- `installer.ps1` instala dependências, roda `pnpm dist` e imprime o caminho e a hora do instalador gerado (`apps/desktop/dist/GearMod-Setup-0.1.0-x64.exe`).
- Ambos fecham qualquer `GearMod.exe` de `apps/desktop/dist/win-unpacked` que esteja rodando, porque esse processo trava a pasta e o build falha.
- Se o build falhar, diga isso no resumo final com o erro. Não diga que o build foi gerado sem conferir a hora do `.exe`.
