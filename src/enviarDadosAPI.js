const axios = require("axios");
const { parseString } = require("xml2js");
const fs = require('fs');

require("dotenv").config();

const API_URL = "https://api.sponteeducacional.net.br/WSAPIEdu.asmx";

async function getAlunoID(nomeAluno) {
  try {
    const alunoResponse = await axios.get(`${API_URL}/GetAlunos`, {
      params: {
        nCodigoCliente: process.env.CODIGO_CLIENTE,
        sToken: process.env.TOKEN,
        sParametrosBusca: `NOME=${nomeAluno}`,
      },
    });

    const result = await parseXML(alunoResponse.data);
    const AlunoID = result.ArrayOfWsAluno.wsAluno[0].AlunoID[0];
    if (AlunoID == 0 || AlunoID === undefined) {
      console.error(`Aluno ${nomeAluno} não encontrado`);
    }
    return AlunoID;
  } catch (error) {
    console.error("Erro na chamada SOAP (getAlunoID):", error);
    throw error;
  }
}

async function getPlanoID(alunoID, dataVencimento, categoriaID) {
  try {
    let sParametrosBusca;
    if ([609, 610, 611].includes(Number(categoriaID))) {
      sParametrosBusca = `AlunoID=${alunoID};DataVencimento=${dataVencimento};Situacao=0;CategoriaID=${categoriaID}`;
    } else {
      sParametrosBusca = `AlunoID=${alunoID};DataVencimento=${dataVencimento};Situacao=0;TipoPlanoContrato=0;CategoriaID=${categoriaID}`;
    }

    const parcelaResponse = await axios.get(`${API_URL}/GetParcelas`, {
      params: {
        nCodigoCliente: process.env.CODIGO_CLIENTE,
        sToken: process.env.TOKEN,
        sParametrosBusca,
      },
    });

    const result = await parseXML(parcelaResponse.data);

    const RetornoOperacao =
      result?.ArrayOfWsParcela?.wsParcela?.[0]?.RetornoOperacao?.[0];
    if (
      String(RetornoOperacao).includes("43") ||
      String(RetornoOperacao).includes("83")
    ) {
      const PlanoID = 0;
      const SituacaoParcela = "A parcela já estava quitada!";
      const NumeroParcela = 0;
      return [PlanoID, NumeroParcela, SituacaoParcela];
    }

    const parcelas = result?.ArrayOfWsParcela?.wsParcela || [];
    
    if ([609, 610, 611].includes(Number(categoriaID))) {
      const categoriaEsperada = categoriaID === 609 ? "DEPENDÊNCIA-01" : 
                               categoriaID === 610 ? "DEPENDÊNCIA-02" : "DEPENDÊNCIA-03";
      
      for (const parcela of parcelas) {
        const categoriaParcela = parcela?.Categoria?.[0] || "";
        if (categoriaParcela.toUpperCase().includes(categoriaEsperada.toUpperCase())) {
          const PlanoID = parcela?.ContaReceberID?.[0] ?? "Erro";
          const SituacaoParcela = parcela?.SituacaoParcela?.[0] ?? "Erro";
          const NumeroParcela = parcela?.NumeroParcela?.[0] ?? "Erro";
          
          console.log(`Id do Plano: ${PlanoID}`);
          console.log(`Numero da Parcela: ${NumeroParcela}`);
          console.log(`Situacao do Plano: ${SituacaoParcela}`);
          console.log(`Categoria encontrada: ${categoriaParcela}`);
          
          return [PlanoID, NumeroParcela, SituacaoParcela];
        }
      }
      
      return ["Erro", "Erro", "Categoria não encontrada"];
    } else {
      const PlanoID =
        result?.ArrayOfWsParcela?.wsParcela?.[0]?.ContaReceberID?.[0] ?? "Erro";
      const SituacaoParcela =
        result?.ArrayOfWsParcela?.wsParcela?.[0]?.SituacaoParcela?.[0] ?? "Erro";
      const NumeroParcela =
        result?.ArrayOfWsParcela?.wsParcela?.[0]?.NumeroParcela?.[0] ?? "Erro";

      console.log(`Id do Plano: ${PlanoID}`);
      console.log(`Numero da Parcela: ${NumeroParcela}`);
      console.log(`Situacao do Plano: ${SituacaoParcela}`);

      return [PlanoID, NumeroParcela, SituacaoParcela];
    }
  } catch (error) {
    console.error("Erro na chamada SOAP (getPlanoID):", error);
    throw error;
  }
}

async function parseXML(xmlData) {
  return new Promise((resolve, reject) => {
    parseString(xmlData, (err, result) => {
      if (err) {
        console.error("Erro na conversão do XML:", err);
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

async function enviarParaAPI(dados = [], mudarProgresso = () => {}) {
  console.log(dados);
  const resultados = [];
  const alunosCache = {};
  const quantidadeDeAlunos = dados.length - 1;
  mudarProgresso(0, quantidadeDeAlunos);
  let alunosprocessados = 0;
  let logHtml = "Enviando dados...";

  console.log(
    `%c${quantidadeDeAlunos} alunos encontrados`,
    "color:hsl(300, 100%, 85%);background-color:hsl(300, 100%, 25%);"
  );

  for (const dado of dados) {
    const [
      nomeAluno,
      produtoIsaac,
      descricaoCobranca,
      serie,
      turno,
      dataVencimentoOriginal,
      mesCompetencia,
      anoReferencia,
      valorBrutoCobranca,
      valorCobrancaBolsas,
      valorMinimoCobranca,
      valorPago,
      dataPagamentoTotal,
    ] = dado;

    try {
      if (nomeAluno === "Nome do Aluno") {
        continue;
      }

      let alunoID = alunosCache[nomeAluno];

      if (!alunoID) {
        alunoID = await getAlunoID(nomeAluno);
        alunosCache[nomeAluno] = alunoID; 
      }

      const isDependencia = String(descricaoCobranca).toUpperCase().includes('DEPENDÊNCIA') ||
                            String(produtoIsaac).toUpperCase().includes('DEPENDÊNCIA');

      let planoID, numeroParcela, situacaoParcela;
      
      if (isDependencia) {
        let categoriaIDs = [609, 610, 611];
        let encontrou = false;
        
        for (const categoriaID of categoriaIDs) {
          [planoID, numeroParcela, situacaoParcela] = await getPlanoID(
            alunoID,
            dataVencimentoOriginal,
            categoriaID
          );
          
          if (planoID !== "Erro" && planoID !== 0) {
            encontrou = true;
            break;
          }
        }
        
        if (!encontrou) {
          logHtml = `Dependência não encontrada para ${nomeAluno}`;
          alunosprocessados++;
          mudarProgresso(alunosprocessados, quantidadeDeAlunos, logHtml);
          continue;
        }
      } else {
        [planoID, numeroParcela, situacaoParcela] = await getPlanoID(
          alunoID,
          dataVencimentoOriginal,
          ""
        );
      }

      if (situacaoParcela === "A parcela já estava quitada!") {
        logHtml = situacaoParcela;
        alunosprocessados++;
        mudarProgresso(alunosprocessados, quantidadeDeAlunos, logHtml);
        console.log(
          `%c${alunosprocessados} de ${quantidadeDeAlunos} alunos processados`,
          "color:white;background-color:black;"
        );
        continue;
      }

      const soapRequestBody = `
      <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
        <QuitarParcelas xmlns="http://api.sponteeducacional.net.br/">
            <nCodigoCliente>${process.env.CODIGO_CLIENTE}</nCodigoCliente>
            <sToken>${process.env.TOKEN}</sToken>
            <sContaReceberID>${planoID}</sContaReceberID>
            <sNumeroParcela>${numeroParcela}</sNumeroParcela>
            <nContaID>6</nContaID>
            <dDataPagamento>${String(dataPagamentoTotal).substring(
              0,
              10
            )}</dDataPagamento>
            <nValorPago>${valorPago}</nValorPago>
            <nFormaPagamentoID>-16</nFormaPagamentoID>
            <lQuitarTodasPendentesPlano>false</lQuitarTodasPendentesPlano>
        </QuitarParcelas>
        </soap:Body>
      </soap:Envelope>
      `;

      await axios
        .post(API_URL, soapRequestBody, {
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: "http://api.sponteeducacional.net.br/QuitarParcelas",
          },
        })
        .then((response) => {
          parseXML(response.data).then((result) => {
            logHtml =
              result["soap:Envelope"]["soap:Body"][0][
                "QuitarParcelasResponse"
              ][0]["QuitarParcelasResult"][0]["RetornoOperacao"][0];
            console.log(logHtml);
          });
        })
        .catch((error) => {
          console.error(error);
          throw error;
        });

      resultados.push({
        AlunoID: alunoID,
        PlanoID: planoID,
      });
    } catch (error) {
      console.error("Erro no processamento:", error);
    }
    alunosprocessados++;
    await mudarProgresso(alunosprocessados, quantidadeDeAlunos, logHtml);
    console.log(
      `%c${alunosprocessados} de ${quantidadeDeAlunos} alunos processados`,
      "color:white;background-color:black;"
    );
  }

  return resultados;
}

function getIdByCategoryName(categoryName) {
  const data = {
    "1ª PARC. ANUIDADE": 190,
    "2023 - Pós E. Médio Técnico em Enfermagem": 533, //PÓS MÉDIO ENFERMAGEM
    "2023 - Pós E. Médio Técnico em Informática": 537, //PÓS MÉDIO INFORMÁTICA
    "2023 - Educação Infantil": 541, //MENSALIDADE EDUCAÇÃO INFANTIL
    "2023 - Fundamental I - 1º ao 5º ano": 542, //MENSALIDADE ENSINO FUNDAMENTAL I
    "2023 - Fundamental II - 6º ao 9º ano": 543, //MENSALIDADE ENSINO FUNDAMENTAL II
    "2023 - E.M. Tec. em Administração - 2º e 3º ano": 573, //MENSALIDADE 3º ANO TEC. ADMINISTRAÇÃO
    "2023 - Ensino Médio Regular - 1º ano": 574, //MENSALIDADE 1º ANO ENSINO MÉDIO
    "2023 - E.M. Tec. em Enfermagem e Informática - 2º e 3º ano": 577, //MENSALIDADE 3º ANO TEC. INFORMÁTICA
    "DEPENDÊNCIA-01": 609,
    "DEPENDÊNCIA-02": 610,
    "DEPENDÊNCIA-03": 611,
    "PÓS MÉDIO ADMINISTRAÇÃO": 625,
    "2ª Via de Histórico Escolar": 588,
    "2ª Via de Carteirinha": 589,
    "Certificado Conclusão de Curso": 591,
    "Declaração Escolar": 595,
    "Agenda Escolar": 596,
    "Mudança de curso": 597,
    "Pasta Ed. Infantil": 605,
    "Material Ed. Infantil": 606,
    "Material Fund. I": 671,
    "Renegociação externa": 645,
    "Renegociação interna": 646,
    "LIVROS ED. INFANTIL": 81,
    "LIVROS ENS. MÉDIO": 85,
    "LIVROS FUND. II": 86,
    "LIVROS FUND. I": 88,
    UNIFORME: 170,
    "MENSALIDADE ESCOLAR": 522,
    "Formatura 1º ano Fund. I": 515,
    "Formatura 9° Ano": 607,
    "Formatura Ensino Médio Técnico": 618,
    "Convite avulso formatura 3º ano Ens. Médio": 714,
    "Chaveiro dia dos Pais": 698,
    "Caneca zero grau": 732,
    "Livro Educação Infantil Maternal l": 416,
    "Livro Educação Infantil Maternal ll": 417,
    "Livro Educação Infantil PRÉ I": 418,
    "Livro Educação Infantil PRÉ II": 419,
    "Livro 1º ano Ensino Médio": 420,
    "Livro 2º ano Ensino Médio": 421,
    "Livro 3º ano Ensino Médio": 422,
    "Livro Fund. II 6º ano": 407,
    "Livro Fund. II 8º ano": 409,
    "Livro Fund. II 9º ano": 410,
    "Livro Fund. II 7º ano": 408,
    "Livro Fund. I 1º ano": 411,
    "Livro Fund. I 2º ano": 412,
    "Livro Fund. I 3º ano": 413,
    "Livro Fund. I 4º ano": 414,
    "Livro Fund. I 5º ano": 415,
    "Short saia": 280,
    "Calça legging": 303,
    "Uniforme Futebol": 314,
    Maiô: 325,
    Sunga: 336,
    "Calça de moletom": 347,
    "Casaco de moletom": 358,
    "Casaco tactel": 388,
    "Short helanca": 399,
    "Short balonê": 426,
    "Saia de balé": 451,
    "Camisa Ensino Médio": 652,
    "Jaleco Curso Técnico": 658,
    "Blusa Seice Dance": 686,
    "Farda Banda": 705,
    "Bermuda Tactel": 707,
    "Blusa Educação Física": 708,
    "Blusa Polo": 709,
    "Blusa Regata": 710,
    "Camisa futsal": 719,
    "Short futsal": 720,
    "Passeio fazendinha": 730,
    "Passeio Arca de Noah": 731,
    "Taxa administrativa": 706,
  };

  const lowerCaseCategoryName = categoryName.toLowerCase();
  for (const [name, id] of Object.entries(data)) {
    if (name.toLowerCase().includes(lowerCaseCategoryName)) {
      return id;
    }
  }

  return "Categoria não encontrada";
}

async function enviarDependenciasAPI(caminhoArquivo, mudarProgresso = () => {}) {
  const dadosBrutos = JSON.parse(fs.readFileSync(caminhoArquivo, 'utf8'));
  const cabecalho = dadosBrutos[0];
  const dados = dadosBrutos.slice(1);

  const dependencias = dados.filter(linha => {
    return (
      String(linha[2]).toUpperCase().includes('DEPENDÊNCIA') ||
      String(linha[1]).toUpperCase().includes('DEPENDÊNCIA')
    );
  });

  return await enviarParaAPI([cabecalho, ...dependencias], mudarProgresso);
}

module.exports = { enviarParaAPI, enviarDependenciasAPI };
