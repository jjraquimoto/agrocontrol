# Relatório de atualização — AgroControl 6.3

**Escopo:** experiência de sincronização sem alterar o algoritmo de registro-a-registro da 6.2.

**Arquivos alterados:** `cloud.js`, `mobile.js`, `mobile.css`, `index.html`, `agrocontrol.html`, `android/app/build.gradle`, `package.json`, `package-lock.json`, `GERAR_APK_WINDOWS.bat`.

**Comportamento:** sincronização após mutação, reação à reconexão, atualização periódica condicional a cada ~2 minutos enquanto a página está visível e não há pendências. Opção manual mantida em Dados e backup; mensagens prioritárias para offline, pendência e conflitos. Lógica do cofre AES-GCM e persistência intacta.

**Cuidados:** não mostrar «Tudo salvo» quando há alterações pendentes; não esconder avisos de conflito; nunca enviar chave secreta para `config.js`; não desinstalar app antes de validar sincronização e exportar backup.

**Validação local:** verificadas sintaxes de scripts JavaScript externos/embutidos, consistência dos arquivos web e Android, e sete cenários do indicador (sincronizado, nuvem indisponível, offline pendente, envio pendente, conflito, acesso offline e demonstração). O navegador gráfico não pôde carregar a página devido a bloqueio do ambiente.

**Limites de validação:** testes automatizados locais não substituem teste de uso real com Supabase, Android e reconexão na rede móvel.
