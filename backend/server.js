const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { GoogleGenAI } = require("@google/genai");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});


/* =====================================================
   AI CHAT API
===================================================== */

app.post("/api/chat", async (req, res) => {

    try {

        const { message, healthData } = req.body;

        if (!message || !message.trim()) {

            return res.status(400).json({
                error: "Message is required."
            });

        }


        const healthInformation =
            JSON.stringify(
                healthData || {},
                null,
                2
            );


        const prompt = `
You are HealthGuide AI, a friendly health information assistant.

Your purpose is to provide general health education and help the
user understand their health information.

IMPORTANT SAFETY RULES:

- Do NOT diagnose diseases.
- Do NOT claim that the user definitely has a condition.
- Do NOT prescribe medication.
- Do NOT tell the user to change or stop prescribed medication.
- If symptoms could indicate an emergency, recommend urgent
  medical attention.
- Encourage the user to consult a qualified healthcare professional
  when appropriate.
- Give clear, simple and understandable answers.
- Use the user's saved health information when it is relevant.
- Never invent information that is not present in the user's records.

USER QUESTION:

${message}


USER'S SAVED HEALTH INFORMATION:

${healthInformation}
`;


        const interaction =
            await ai.interactions.create({

                model: "gemini-3.6-flash",

                input: prompt,

                generation_config: {
                    thinking_level: "low"
                }

            });


        const reply =
            interaction.output_text;


        res.json({
            reply: reply
        });


    } catch (error) {

        console.error(
            "Gemini API Error:",
            error
        );

        res.status(500).json({
            error: error.message
        });

    }

});


/* =====================================================
   START SERVER
===================================================== */

const PORT = 3000;

app.listen(PORT, () => {

    console.log(
        `HealthGuide AI server running at http://localhost:${PORT}`
    );

});