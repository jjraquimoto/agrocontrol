# Relatório técnico — AgroControl 6.2 (22/11/2026)

## Base
Projeto AgroControl 6.1 unificado, derivado do `agrocontrol.zip` enviado pelo usuário. Mantidos módulos de rebanho, sanidade, lotes, produção/pesagens, movimentações, dashboard, relatórios, backup, autenticação Supabase e estrutura de operações de sincronização `agro_apply_changes_v54`.

## Mudanças no código

1. **Novo `vault.js`**: proteção opt-in do cache por conta e fazenda com AES-256-GCM via WebCrypto; IV único de 96 bits por gravação; AAD vincula usuário + fazenda + versão; PBKDF2-SHA256 com 310.000 iterações e sal de 128 bits. Chave fica somente na memória da sessão. Material cifrado inclui dados, revisão, base remota e indicador de alterações pendentes.
2. **Migração segura**: coleta diários e caches das fazendas da conta, cifra e verifica os dados antes de ativar o cofre; a cópia antiga só é removida após a gravação da credencial verificável. Se faltar espaço ou falhar a gravação, o cache anterior é preservado. Recuperação remove resíduos antigos após desbloqueio de uma migração concluída.
3. **Escrita serializada** por fazenda no cofre: gravações AES assíncronas entram em fila e são persistidas na ordem de submissão, evitando que uma cifra atrasada sobrescreva outra mais recente.
4. **Persistência aguardada**: os formulários e ações destrutivas agora aguardam conclusão de `mutate()` e de `AGRO_PERSIST_FARM`; a mensagem de sucesso ocorre após a gravação. Em caso de falha, o estado em memória é revertido.
5. **Recuperação offline**: ao abrir um cofre, a senha local é verificada sem conexão; o diário cifrado é carregado e permanece pendente até autenticação online. O fluxo de login online exige destravar o cofre existente no dispositivo.
6. **Interface**: mantém os cartões e a navegação para celular da 6.1. Novo diálogo com campos de senha mascarados ao ativar/desbloquear o cofre. Textos esclarecem os limites de segurança.
7. **Android**: incremento de `versionCode=3`, `versionName=6.2.0`; `allowBackup=false` preservado; bloqueio de tráfego HTTP claro (`usesCleartextTraffic=false`). `GERAR_APK_WINDOWS.bat` refeito para remover caracteres de controle que impediam localizar o APK.
8. **Publicação**: `scripts/copy-web.mjs` passa a incluir `vault.js`, service worker e recursos estáticos da versão 6.2. Cópias de `www/` e do diretório de recursos Android sincronizadas.

## Não alterado

- Estrutura SQL 5.3/5.4 e funções RPC: **não foram modificadas**, para não realizar migração arriscada sem acesso ao projeto de banco.
- Não há novo módulo financeiro, de insumos ou reprodução; o foco desta versão foi corrigir os bloqueadores anteriores: proteção local e compilação Android.

## Riscos e limites abertos

- Criptografia local só é ativada mediante configuração voluntária. A interface ainda usa WebView e localStorage; o volume de dados é limitado pelas cotas do navegador/WebView. Não há migração para IndexedDB nesta versão.
- Identificação de usuário e fazendas e tokens de sessão persistidos são metadados **fora** da criptografia do cofre. Backups JSON exportados são legíveis.
- A revogação de acesso online não bloqueia instantaneamente um cache offline previamente autorizado. O código não foi submetido a pentest ou auditoria independente.
- Senha perdida implica perda da cópia cifrada local; dados já sincronizados podem ser recuperados da nuvem após limpeza consciente dos dados locais. **Dados não sincronizados não podem ser recuperados sem a senha.**
- O banco real estava sem credenciais publicáveis em `config.js`, portanto não foi possível autenticar, conferir RLS, executar a RPC nem validar sincronização entre dois usuários.
- O SDK Android não está disponível neste ambiente: o APK final não foi compilado, assinado nem testado em um dispositivo físico.
- O Chromium local foi bloqueado ao abrir páginas; testes gráficos novos não puderam ser executados. A interface mobile validada anteriormente na 6.1 foi preservada.

## Testes locais

- `node --check` nos arquivos JS e scripts HTML: **aprovado**.
- Teste do cofre com duas fazendas: migração, cifragem, leitura, escrita, reinício, senha inválida, adulteração, fila de gravação e limpeza ao sair: **aprovado**.
- Integridade de arquivos copiados para `www/` e assets Android: **aprovada**.
- Compilação Gradle, sincronização Supabase, instalação Android e desempenho: **não realizados**.

## Etapas restantes antes de produção comercial

Executar testes com dois perfis Supabase e duas fazendas, confirmar políticas RLS, testar conflitos e revogação de permissões, compilar e instalar o APK em Android real, testar offline após reiniciar o aparelho, restaurar dados a partir de backup, auditar segurança, completar política de privacidade, verificar capacidade e preparar release assinado.
