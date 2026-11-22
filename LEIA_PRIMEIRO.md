# AgroControl 6.3.2 — Ajustes para diferentes celulares

Esta é uma manutenção visual em cima do AgroControl 6.3.1. A lógica de cadastro, sincronização e cofre offline foi preservada. Não foi necessário alterar o schema do Supabase.

## Ajustes

- Menu **Mais** responsivo: o nome **Movimentações** e as demais opções quebram linha sem exigir rolagem lateral.
- Layout mais resistente a diferenças de largura, fonte e orientação entre aparelhos Android.
- Barra inferior, cabeçalho, cartões, tabelas, formulários e botões com limites de largura e quebra de texto.
- O menu **Mais** rola verticalmente em telas baixas e evita a rolagem do conteúdo atrás dele.
- A adaptação mobile é usada até 900 pixels, cobrindo também celulares maiores na horizontal.
- Versão do cache estático atualizada para evitar uso de CSS antigo quando o aplicativo é atualizado.

## Instalar / atualizar o APK

1. **Antes de trocar de APK**, entre no AgroControl atual, confira se não existem registros pendentes de sincronização e salve um backup JSON. Não desinstale nem limpe dados do aplicativo antigo.
2. Extraia este ZIP em pasta nova no Windows.
3. Preencha APENAS o `config.js` da raiz com a URL pública do projeto e sua chave **publishable** do Supabase. Se copiar a configuração da versão anterior, não copie chaves secretas.
4. Abra o CMD na pasta principal. Execute `npm ci` e depois `npm run android:sync`.
5. Abra a pasta `android` no Android Studio. Use **Build → Generate App Bundles or APKs → Generate APKs**. O arquivo fica em `android/app/build/outputs/apk/debug/app-debug.apk`.
6. Instale **sobre** a versão anterior apenas se tiver a mesma assinatura. Se o Android pedir desinstalação, não continue sem confirmar backup e sincronização dos dados.
7. Feche e reabra o app após a instalação. Confirme a versão **6.3.2** na tela de login. Teste os menus, Movimentações, cadastros e relatórios nos três aparelhos.

## Se algum celular ainda ficar desorganizado

Envie um print mostrando **qual tela** e qual parte saiu do lugar, junto com o modelo do celular e se o tamanho da fonte está aumentado. Isso permitirá corrigir o aparelho específico, em vez de adivinhar a causa.

## Verificações realizadas

- `node --check` em `mobile.js`, `cloud.js`, `vault.js` e `service-worker.js`: OK.
- `node scripts/test-vault.cjs`: OK (migração, criptografia, reinício, senha incorreta, alteração indevida, gravações concorrentes e logout).
- Análise sintática de `mobile.css`: sem erro de análise.
- Arquivos web copiados para `www/` e espelhados no projeto Android.

**Limitação:** não foi possível executar um teste visual em navegador neste ambiente (navegação bloqueada). Não foi compilado o APK aqui e não foram testados o Supabase real nem celulares físicos. Estes passos devem ser validados no Windows e nos aparelhos.
