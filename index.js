import pg from 'pg';
const { Pool } = pg;
import { Configuration, OpenAIApi } from 'openai';
import fs from 'fs';
import { stringify } from 'csv-stringify/sync';
import dotenv from 'dotenv';
import cliProgress from 'cli-progress';
import { StopWatch } from 'stopwatch-node';
import { encode } from 'gpt-3-encoder';

// Load environment variables from .env file
dotenv.config();

const context = 'You are a translation engine that, in the contex of comex, can only translate text from english to spanish and cannot interpret it. Do not supress any message.';
const contextTokenSize = encode(context).length;

// Set up OpenAI API credentials
const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

// Set up Postgres database connection pool
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  max: 10,
  ssl: { rejectUnauthorized: false },
});

const delay = time => new Promise(res => setTimeout(res, time));

async function getTranslation(prompt, retries = 3) {
  let lastError;
  for (let trycount = 0; trycount < retries; trycount++) {
    try {
      const response = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: context
          },
          {
            role: "user",
            content: prompt
          },
        ],
      });
      if (response.status !== 200) {
        throw response;
      }
      if (response.data.choices[0].message.content)
        return response.data.choices[0].message.content;
      console.log(response.data);
      throw response;
    } catch (e) {
      if (e.response.status === 429 && trycount < retries) {
        await delay(20000);
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

async function loadData() {
  if(fs.existsSync('translations.csv')) {
    
  }
}

(async () => {
  const sw = new StopWatch('sw');
  sw.start('Fetching data');
  // Fetch data from Postgres database
  const { rows } = await pool.query("SELECT idi18n, dsmsgkey, dsenus, dsptbr FROM smart.i18n WHERE dtdeleted IS NULL ORDER BY dsmsgkey");

  rows.forEach(r => { r.dseses = '' });

  const csv1 = stringify(rows, { header: true });
  fs.writeFileSync('translations.csv', csv1);

  // Get all the enus messages in an array
  const enusArray = rows.map(r => r.dsenus);

  sw.stop();

  sw.start('Translating');

  const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_grey);
  bar.start(rows.length - 1, 0);

  const getIdealChunkSize = (i) => {
    let ret = 1;
    for (let o = 1; o < enusArray.length - i; o++) {
      const tokenSize = encode(enusArray.slice(i, i + o).join('\n\n')).length;
      const totalTokens = (10 + tokenSize + contextTokenSize) * 3; // response em espanhol é maior que a entrada em ingles...
      if (totalTokens < 4096) {
        ret = o;
      } else {
        break;
      }
    }
    return ret;
  };

  let chunkSize = 10;
  let startTime = +new Date();
  const requests = [];
  for (let i = 0; i < enusArray.length; i += chunkSize) {
    //chunkSize = getIdealChunkSize(i);
    const chunk = enusArray.slice(i, i + chunkSize);
    const prompt = chunk.join('\n\n');
    const now = +new Date();
    if (requests.length > 18) {
      const req18 = requests[requests.length - 18];
      if (now - req18 < 60000) {
        await delay((60000 - (now - req18)));
      }
    }
    const translation = await getTranslation(prompt);
    requests.push(+new Date());
    const chunkEs = translation.split('\n\n');

    // Quando há termos repetidos em sequencia, o chatgpt lima um... mas nós não podemos...
    let iEs = 0;
    for (let iEn = 0; iEn < chunk.length; iEn++) {
      if (iEn > 0 && chunk[iEn - 1] !== chunk[iEn]) {
        iEs++;
      }
      rows[i + iEn].dseses = chunkEs[iEs];
      bar.update(i + iEn);
    }
    iEs = 0;
  }

  bar.stop();

  sw.stop();

  sw.start('Updating database');

  // Loop through the result set and translate messages
  Promises.all(
    rows.map(row => pool.query("UPDATE smart.i18n SET dseses = $1 WHERE idi18n = $2", [row.dseses, row.idi18n]))
  );

  sw.stop();

  sw.start('Saving local file');

  // Write translations to CSV file
  const csv = stringify(rows, { header: true });
  fs.writeFileSync('translations.csv', csv);

  sw.stop();

  sw.start('Closing database');
  // Close database connection pool
  await pool.end();
  sw.stop();

  sw.prettyPrint();
})();
