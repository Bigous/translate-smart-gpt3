const { Pool } = require('pg');
const openai = require('openai');
const fs = require('fs');
const { promisify } = require('util');
const stringifyAsync = promisify(require('csv-stringify'));
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Set up OpenAI API credentials
openai.api_key = process.env.OPENAI_API_KEY;

// Set up Postgres database connection pool
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

(async () => {
  // Fetch data from Postgres database
  const { rows } = await pool.query("SELECT idi18n, dsmsgkey, dsenus FROM smart.i18n WHERE dtdeleted IS NULL ORDER BY dsmsgkey");

  // Loop through the result set and translate messages
  const translations = [];
  for (const row of rows) {
    const idi18n = row.idi18n;
    const dsmsgkey = row.dsmsgkey;
    const dsenus = row.dsenus;

    // Call GPT-3 API to generate message in Spanish
    const prompt = `Translate the following message to Spanish for the comex context: ${dsenus}`;
    const response = await openai.Completion.create({
      engine: "text-davinci-002",
      prompt: prompt,
      maxTokens: 100,
      n: 1,
      stop: null,
      temperature: 0.5,
    });
    const dseses = response.choices[0].text.trim();

    // Store translation result in an object
    const translation = { idi18n, dsmsgkey, dsenus, dsptbr, dseses };
    translations.push(translation);

    // Update Postgres table with generated message
    // await pool.query("UPDATE smart.i18n SET dseses = $1 WHERE idi18n = $2", [dseses, idi18n]);
  }

  // Write translations to CSV file
  const csv = await stringifyAsync(translations, { header: true });
  fs.writeFileSync('translations.csv', csv);

  // Close database connection pool
  await pool.end();
})();
