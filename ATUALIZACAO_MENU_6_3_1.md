# AgroControl 6.3.1 — Menu Mais no celular

Esta correção usa como base o AgroControl 6.3 (sincronização automática). A única mudança funcional é a navegação móvel do menu **Mais**:

- Nomes das áreas (inclusive **Movimentações**) com fonte proporcional ao espaço disponível.
- Botões em duas colunas, com ícones acima dos nomes, sem rolagem horizontal.
- Painel limitado à largura da tela e com rolagem **vertical** quando necessário.
- Botões da conta adaptados à largura estreita.
- Nenhum módulo de cadastro ou sincronização foi alterado.

**Para gerar o APK no Windows:** extraia em uma pasta nova, copie do projeto anterior apenas o `config.js` com a URL e chave *publishable* (nunca `service_role`); execute no terminal `npm ci` e `npm run android:sync`, abra a pasta `android` no Android Studio e use Build → Generate App Bundles or APKs → Generate APKs. Se já tiver configurado o SDK, pode usar o `GERAR_APK_WINDOWS.bat` após instalar o npm.

**Antes de instalar:** faça backup e não desinstale o app anterior; instale primeiro em dispositivo de teste. Esta correção visual não é homologação de banco de dados ou segurança offline.
