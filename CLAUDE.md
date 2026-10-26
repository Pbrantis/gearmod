# AgentBoard

## Build

Ao terminar qualquer task que mude codigo, gere o build rodando na raiz do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

- O script instala dependencias, roda `pnpm dist` e imprime o caminho e a hora do instalador gerado (`apps/desktop/dist/AgentBoard-Setup-0.1.0-x64.exe`).
- Ele fecha sozinho qualquer `AgentBoard.exe` de `apps/desktop/dist/win-unpacked` que esteja rodando, porque esse processo trava a pasta e o build falha.
- Se o build falhar, diga isso no resumo final com o erro. Nao diga que o build foi gerado sem conferir a hora do `.exe`.
- Nao rodar o build em tasks que so mexem em docs.
