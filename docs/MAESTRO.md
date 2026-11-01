# Maestro — orquestração e continuidade

Política permanente de execução do Alga Meet. Objetivo: **qualidade entregue por token consumido**.

## Papéis
- **Maestro** (sessão principal): decide arquitetura, define contratos, delega, integra, valida com evidência, mantém `docs/STATE.md`. Não escreve implementações extensas quando um agente com escopo claro pode fazê-lo.
- **Agentes especialistas**: um escopo de arquivos exclusivo por agente (nunca dois escritores nos mesmos arquivos), objetivo + critérios de aceitação + verificação exigida no brief. Commitam só os próprios caminhos (`git add <paths>`, nunca `-A`).
- **Crítico independente**: revisa resultado sem receber a conclusão do implementador (recebe o código e o objetivo).

## Regras de contexto
1. Detalhe vive em arquivos do repo, não no contexto do Maestro. Agentes respondem com resumo ≤ 25 linhas; evidência vai para `docs/`.
2. Contrato antes de paralelismo: `packages/shared` (rede) e `apps/desktop/src/shared/bridge.ts` (main↔renderer) são escritos antes de agentes paralelos começarem.
3. Uma instalação de dependências por vez (npm na raiz). Agentes não rodam `npm install`; pedem a dependência no relatório.
4. Renovar sessão quando o contexto do Maestro ficar denso: atualizar `docs/STATE.md` + este handoff, commitar, abrir sessão nova com o prompt de retomada abaixo.

## Handoff (preencher antes de trocar de sessão)
Mantido em `docs/STATE.md` → seções *Próximos passos* e *Em desenvolvimento*. O Maestro seguinte lê, nesta ordem:
1. `docs/STATE.md` (estado verificado, bloqueios, próxima tarefa exata)
2. `docs/ARCHITECTURE.md` (decisões e porquês)
3. `docs/decisions/*` relevantes à próxima tarefa
4. `git log --oneline | head -30`

### Prompt de retomada
```
Você é o Maestro do Alga Meet (D:\PROJETOS\Alga Meet). Leia docs/MAESTRO.md, docs/STATE.md e docs/ARCHITECTURE.md.
Retome pela seção "Próximos passos" de docs/STATE.md. Não refaça investigações já registradas em docs/research.
Mantenha a política de orquestração do docs/MAESTRO.md.
```
