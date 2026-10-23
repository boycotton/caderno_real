# Caderno PDF — guia de instalação e uso

App pessoal para o **Galaxy Tab S9 FE** (funciona em qualquer navegador moderno): ler e editar PDFs,
criar notas A4 com quadriculado/pauta/pontos, escrever com a **S Pen** e salvar direto no **Google Drive**.

É um *web app instalável* (PWA): roda no Chrome, ganha ícone na tela inicial, abre em tela cheia
e funciona offline (só o Drive precisa de internet). Não precisa de Play Store nem de computador
para compilar nada.

Bibliotecas usadas (todas públicas e de código aberto, já incluídas na pasta `vendor/`):
pdf.js (Mozilla, Apache 2.0) · pdf-lib (MIT) · perfect-freehand (MIT) · fontes Pixelify Sans e VT323 (SIL OFL).

**Visual anos 90:** a interface imita o Windows 95/98 (botões em relevo, janelas com barra de título azul,
área de trabalho verde-azulada, barra de status, balões de dica amarelos) e a tela inicial tem fundo estrelado e título em WordArt, no estilo das páginas pessoais da época.
As folhas e anotações não mudam: o PDF salvo fica exatamente igual. 

---

## 1. Publicar o app (uma vez, ~5 minutos)

O app precisa de um endereço **https** para poder ser instalado e para o login do Google funcionar.
Duas opções gratuitas — escolha uma:

### Opção A — Netlify Drop (mais simples)
1. No computador, abra <https://app.netlify.com/drop> e crie uma conta grátis.
2. Arraste a pasta `notas-app` inteira para a página.
3. Pronto: você recebe um endereço como `https://nome-aleatorio.netlify.app`.
   (Em *Site configuration → Change site name* dá para trocar por algo como `caderno-arthur`.)

### Opção B — GitHub Pages
1. Crie uma conta em <https://github.com> e um repositório novo chamado `caderno` (público).
2. Em *Add file → Upload files*, envie **o conteúdo** da pasta `notas-app` (o `index.html` deve ficar na raiz).
3. Em *Settings → Pages*, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)` e salve.
4. Em 1–2 minutos o app fica em `https://SEU-USUARIO.github.io/caderno/`.

> O app não contém senhas. O "ID do cliente" do Google não é segredo — ele só funciona no endereço que você cadastrar.

---

## 2. Google Drive

Já vem configurado (projeto `caderno` no Google Cloud da conta ar.barbosademiranda@gmail.com, modo Teste,
origem autorizada `https://boycotton.github.io`). É grátis: a Drive API não cobra e não pede cartão.
Na primeira vez o Google mostra "O Google não verificou este app" → **Continuar**.

---

## 3. Instalar no tablet (vira um ícone de app de verdade)

1. No Tab S9 FE, abra o endereço do app no **Chrome**.
2. Menu **⋮ → Adicionar à tela inicial → Instalar** (em algumas versões aparece direto como **Instalar app**).
3. O Chrome cria um app de verdade: o ícone aparece na **tela inicial e na gaveta de apps**, abre em tela cheia
   (sem barra de endereço), aparece na lista de apps recentes como um app separado e pode ser desinstalado
   como qualquer outro app.
4. Abra o **Caderno** pelo ícone → **⚙ Configurações** → cole o **ID do cliente** → **Testar conexão**.

> Precisa ser pelo endereço **https** do passo 1 — abrir o `index.html` direto do armazenamento não permite instalar.
> Também funciona no Samsung Internet: menu **☰ → Adicionar página a → Tela inicial**.

## 4. Como usar

### Área de trabalho
- Ícones: **Google Drive**, **Compartilhados**, **Neste tablet** e as pastas que você fixar.
- **Nova pasta** (barra de baixo) cria a pasta no Drive e já coloca o ícone na área de trabalho.
- Em qualquer pasta do Drive: **⋮ → Fixar na área de trabalho**. Segurar o ícone fixado → tirar.
- **Cadeado** (barra de baixo e barra de ferramentas): tela cheia, prende o "voltar" e mantém a tela ligada,
  para não sair do app esbarrando o braço. Para bloqueio total use também o recurso do Android
  *Configurações → Segurança → Fixar apps*.

### Abrir e criar
- **Nova nota**: escolha o tipo de folha (Quadriculado, Pautado, Pontilhado, Milimetrado, Cornell, Em branco),
  a cor do papel, o tamanho do quadrado e a orientação. O padrão **Creme · Quadriculado 8,6 mm** reproduz
  exatamente as cores e o quadriculado do seu PDF *Lista 02*.
- **Google Drive** (janela principal da tela inicial, como o Windows Explorer):
  - navegue pelas pastas (toque para entrar; **Voltar**, **Acima** e a barra **Endereço** para voltar);
  - abas **Meu Drive**, **Compartilhados** (o que te enviaram) e **Recentes**, além da busca;
  - **Nova pasta** cria uma pasta onde você estiver;
  - **Nova nota aqui** cria a nota já dentro da pasta aberta — ao tocar em Salvar ela vai direto para lá;
  - **Enviar PDF** manda PDFs do tablet para a pasta aberta;
  - o botão **⋮** de cada item: Abrir, **Renomear**, **Mover para…** (escolhe a pasta de destino) e
    **Mover para a lixeira** (dá para restaurar pelo Drive por 30 dias).
- **Abrir do tablet**: qualquer PDF do armazenamento (ou do app do Drive pelo seletor de arquivos do Android).
- Em **Continuar**, ficam os documentos recentes — inclusive os que ainda não foram enviados.

### Ferramentas (barra de cima)
| Ferramenta | O que faz |
|---|---|
| Caneta | Sensível à pressão da S Pen |
| Lápis | Traço mais fino, tom grafite levemente transparente |
| Marca-texto | Largo e translúcido |
| Borracha | Apaga o traço inteiro que tocar. **Segurar o botão da S Pen = borracha temporária** |
| Prever formas (botão ✨) | Ligado: ao soltar a caneta, o traço vira reta, seta, curva, círculo, elipse, retângulo, triângulo ou polígono. Reta, seta e curva ganham **bolinhas para ajustar** (curva: início, meio e fim); tocar fora confirma |
| Formas | Linha, seta, retângulo, elipse, triângulo e triângulo retângulo. Linhas se alinham a cada 15°; retângulo/elipse quase quadrados viram quadrado/círculo perfeitos. "Preencher" deixa a forma com fundo translúcido |
| Texto | Toque na página e digite (o teclado Samsung também aceita escrita à mão). Toque num texto existente para editar |
| Laço | Circule itens (ou toque em um) para selecionar |

Tocar de novo no botão de Formas abre a lista de formas.

### Modo あ (aprender japonês)
- Botão **あ** na barra: liga/desliga.
- Com ele ligado, **encoste a caneta no primeiro caractere e arraste até o último** da palavra (você escolhe o
  trecho; o app não tenta adivinhar). Ao soltar aparece a definição exatamente desse trecho. Um toque = um caractere.
  Mostra: palavra, leitura, significados (inglês, do JMdict), a forma do verbo/adjetivo
  (ex.: 食べなかった → 食べる, passado negativo) e os kanji com significado (em português quando houver),
  leituras on/kun, traços e nível JLPT.
- Funciona com o texto que já existe no PDF (sem OCR): PDFs escaneados não têm texto.
- O dicionário é baixado aos poucos e fica guardado no tablet para usar offline.
- Dados: JMdict e KANJIDIC2 © EDRDG, licença CC BY-SA 4.0.

### Biblioteca japonesa
Na primeira vez que você entra no Google Drive, o app coloca na sua pasta **Japonês** (ou cria uma)
18 livros do Aozora Bunko (domínio público) diagramados com furigana — de contos curtos (蜘蛛の糸,
ごん狐, 注文の多い料理店) até 坊っちゃん e 銀河鉄道の夜. Eles têm texto de verdade, então o modo あ funciona neles.

### Copiar e colar rápido
1. Selecione com o **Laço**. Aparece o menu: **Copiar · Recortar · Duplicar · Cor · Carimbo · Excluir**.
2. Arraste a seleção para mover; puxe a **bolinha azul** do canto para redimensionar.
3. **Colar** (ícone de prancheta): cada toque na página cola **mais uma cópia** — ótimo para repetir símbolos.
   Funciona entre páginas e entre documentos.
4. **Carimbo** guarda a seleção para sempre (ex.: resistor, capacitor, fonte, terra). Pelo botão de **carimbos**
   você escolhe um e vai tocando onde quer colar, em qualquer documento.

Atalhos com teclado físico: Ctrl+Z / Ctrl+Y, Ctrl+C / Ctrl+X / Ctrl+V, Ctrl+D (duplicar), Delete.

### S Pen e dedos
- Na primeira vez que a S Pen encosta na tela, o app passa para o modo **"Só a S Pen desenha"**:
  o dedo apenas rola (um dedo) e dá zoom (pinça). A palma apoiada é ignorada enquanto a caneta está na tela.
- No menu **⋮ → Só a S Pen desenha / Dedo também desenha** dá para trocar esse modo. Desligado: um dedo desenha e dois dedos rolam/dão zoom.
- Pairar a S Pen mostra a área da borracha e a prévia do que vai ser colado.

### Recorte (câmera) e calculadora
- **Câmera**: arraste um retângulo sobre a página. O recorte vira o item do **Colar** (só o último fica guardado,
  vale para todos os documentos e continua lá depois de fechar o app). Ao colar, ele já fica selecionado:
  arraste para mover e puxe o canto azul para redimensionar. Vai junto no PDF salvo.
- **Calculadora** (ícone de calculadora): científica, no estilo da do Windows 95; arraste pela barra azul.

### Retas com ângulo (botão ✨ ligado)
- Desenhe a reta e **segure** a caneta parada: ela vira reta e continua seguindo a caneta (esticar/girar)
  com o **ângulo** ao lado. Encaixa em múltiplos de 15° e fica **paralela (∥) ou perpendicular (⊥)**
  às retas que já estão na página quando chega perto. O mesmo vale ao arrastar as bolinhas das pontas.

### Pastas em "Neste tablet"
- **Nova pasta** funciona também em *Neste tablet*. **⋮ → Mover para pasta…** em cada documento;
  **Nova nota** dentro de uma pasta já cria a nota nela.

### Documentos abertos (como funciona)
- O PDF fica no Google Drive. Para mostrar e editar, o tablet precisa de uma cópia — o app baixa **uma vez** e guarda.
- Voltar para a área de trabalho **não fecha** o documento: ele aparece na **barra de tarefas** (embaixo) e volta
  na hora, na mesma página. Se você editou um arquivo do Drive, ele é **enviado sozinho** ao voltar.
- Abrir de novo pelo Drive usa a cópia do tablet; só baixa outra vez se o arquivo mudou no Drive.
- **×** na barra de tarefas (ou na lista ▾ do editor) fecha o documento e apaga a cópia do tablet.
- **Iniciar** (canto inferior esquerdo): Nova nota, Nova pasta, Abrir PDF do tablet, Configurações.

O campo com o nome do documento na barra (▾) lista os documentos abertos/recentes: toque para trocar, **×** para fechar.

### Páginas
- **+** (canto inferior esquerdo) adiciona uma página depois da atual, com o modelo que você escolher —
  dá para misturar quadriculado e pautado no mesmo caderno, ou acrescentar folhas quadriculadas a um PDF da faculdade.
- **Páginas** (ícone de folhas): miniaturas, duplicar, mover para cima/baixo e excluir.

### Salvar
- Tudo o que você faz é guardado **automaticamente no tablet** a cada segundo. Fechar o app não perde nada.
- **Salvar** envia para o Drive:
  - PDF aberto do Drive → **substitui o arquivo original** (o Drive guarda as versões anteriores em
    *Gerenciar versões*). Se o arquivo foi alterado em outro lugar, o app pergunta antes.
  - Nota nova ou PDF do tablet → escolha a pasta no Drive (dá para criar pasta) ou baixe no tablet.
- **⋮ → Salvar cópia no Drive / Baixar PDF / Compartilhar** para as outras opções.

### Suas anotações continuam editáveis
O PDF salvo é um PDF normal: Google Drive, Samsung Notes, Acrobat etc. mostram as anotações.
Além disso, o app guarda dentro do arquivo uma cópia de cada traço, então quando você **reabrir no Caderno**
cada traço, forma e texto continua selecionável, apagável e movível — não vira "imagem".
Salvar várias vezes não faz o arquivo crescer.

---

## Limitações conhecidas
- Textos usam a fonte Helvetica do PDF: letras com acento funcionam; símbolos especiais (✓, emojis, letras gregas)
  aparecem como "?" no PDF salvo. Para símbolos, escreva à mão ou use um carimbo.
- Em zoom muito alto (acima de ~2,5×) a página pode ficar um pouco menos nítida — limite de memória para o tablet não travar.
- PDFs protegidos por senha podem não salvar.
- O Google libera o acesso por 1 hora de cada vez (app sem servidor). O app renova sozinho num toque da área de trabalho ou da barra, com a sua conta já escolhida (a janelinha abre e fecha sozinha).

## Estrutura dos arquivos
```
index.html            página do app
manifest.webmanifest  instalação (ícone, nome)
sw.js                 funcionamento offline
css/app.css           visual anos 90 (cores e relevos no topo do arquivo)
js/main.js            telas, menus, salvar
js/explorer.js        explorador do Google Drive (pastas)
js/editor.js          páginas, zoom, ferramentas, S Pen
js/ink.js             traços, formas e texto
js/templates.js       modelos de folha (quadriculado etc.)
js/pdfio.js           abrir/salvar PDF com anotações editáveis
js/drive.js           Google Drive
js/store.js           rascunhos no tablet
vendor/               pdf.js, pdf-lib, perfect-freehand
```
Para criar novos modelos de folha, edite `js/templates.js` (cores em `PAPERS`, tipos em `KINDS`).
