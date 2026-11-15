# Entregas do Dashboard de Recuperação de Carteiras

## Dashboard e integração com a API
- [x] O app em React com Tailwind CSS deve se conectar à API `https://acceptable-tenderness-production-f1b33822.up.railway.app`, tratando estados de carregamento, sucesso e falha nas requisições.
- [x] A rota `/found` (GET) deve buscar a lista de carteiras encontradas e exibi-la em cards.
- [x] Cada card deve mostrar a Moeda (BTC/ETH), o Endereço, o Saldo e a Frase Mnemônica, com botão para copiar a frase.

## Controle de rede e motor
- [x] A rota `/set_network` (POST) deve ser acionada por dois botões BTC e ETH, enviando `{ "mode": "BTC" }` ou `{ "mode": "ETH" }`.
- [x] O botão único “Iniciar/Parar Motor” deve alternar entre as rotas `/start` e `/stop` (POST), refletindo o estado atual na interface.
- [x] Quando o motor estiver ativo, a lista de carteiras deve ser atualizada automaticamente a cada 10 segundos; a atualização deve parar quando o motor for parado.

## Direção visual
- [x] A interface deve usar tema Dark Profissional com fundo `#0a0a0c`, cores de destaque em Indigo/Roxo, estilo moderno com cards e ícones da biblioteca `lucide-react`.
- [x] O layout deve ser responsivo e manter os estados de loading, erro, vazio e sucesso legíveis.
