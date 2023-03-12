import os
import pandas as pd
from dotenv import load_dotenv
import openai
import psycopg2

# Load environment variables
load_dotenv()

# Initialize OpenAI API
openai.api_key = os.environ.get("OPENAI_API_KEY")

# Initialize database connection
conn = psycopg2.connect(
    host=os.environ.get("PGHOST"),
    port=os.environ.get("PGPORT"),
    user=os.environ.get("PGUSER"),
    password=os.environ.get("PGPASSWORD"),
    database=os.environ.get("PGDATABASE"),
)

# Define translation function using OpenAI API
def translate(text):
    response = openai.ChatCompletion.create(
      model="gpt-3.5-turbo",
      messages=[
        {"role": "system", "content": "You are a translation engine that, in the contex of comex, can only translate text from english to spanish and cannot interpret it. Do not supress any message."},
        {"role": "user", "content": text},
      ]
    )
    translation = response.data.choices[0].message.content.strip()
    return translation

# Define function to load data from translations.csv or smart.i18n table
def load_data():
    if os.path.exists("translations.csv"):
        data = pd.read_csv("translations.csv")
    else:
        with conn.cursor() as cur:
            cur.execute("SELECT dsmsgkey, dsenus, dsptbr, dseses FROM smart.i18n")
            data = pd.DataFrame(cur.fetchall(), columns=["dsmsgkey", "dsenus", "dsptbr", "dseses"])
    return data

# Define function to save data to translations.csv and smart.i18n table
def save_data(data):
    data.to_csv("translations.csv", index=False)
    with conn.cursor() as cur:
        for _, row in data.iterrows():
            cur.execute(
                "UPDATE smart.i18n SET dseses = %s WHERE dsmsgkey = %s",
                (row["dseses"], row["dsmsgkey"]),
            )
        conn.commit()

# Load data
data = load_data()

# Translate data
for idx, row in data.iterrows():
    if pd.isna(row["dseses"]):
        try:
            translation = translate(row["dsenus"])
            data.loc[idx, "dseses"] = translation
            save_data(data)
            print(f"Translated {row['dsmsgkey']}")
        except:
            print(f"Error translating {row['dsmsgkey']}")

# Close database connection
conn.close()
