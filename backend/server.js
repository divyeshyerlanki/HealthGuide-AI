const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
// const { GoogleGenAI } = require("@google/genai");
const Groq = require("groq-sdk");
const mysql = require("mysql2/promise");

dotenv.config();

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    port: process.env.DB_PORT,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const app = express();

app.use(cors());
app.use(express.json());

// const ai = new GoogleGenAI({
//     apiKey: process.env.GEMINI_API_KEY
// });

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

/* =====================================================
   SIGNUP API
===================================================== */

app.post("/api/signup", async (req, res) => {

    try {

        const {
            fullName,
            email,
            dob,
            bloodGroup,
            password
        } = req.body;


        // Basic validation
        if (!fullName || !email || !password) {

            return res.status(400).json({
                error: "Name, email and password are required."
            });

        }


        // Check if email already exists
        const [existingUsers] = await db.execute(
            "SELECT id FROM users WHERE email = ?",
            [email]
        );


        if (existingUsers.length > 0) {

            return res.status(409).json({
                error: "An account with this email already exists."
            });

        }


        // Create user
        await db.execute(
            `INSERT INTO users
            (full_name, email, date_of_birth, blood_group, password)
            VALUES (?, ?, ?, ?, ?)`,
            [
                fullName,
                email,
                dob || null,
                bloodGroup || null,
                password
            ]
        );


        res.status(201).json({
            message: "Account created successfully."
        });


    } catch (error) {

        console.error(
            "Signup Error:",
            error
        );

        res.status(500).json({
            error: "Unable to create account."
        });

    }

});

/* =====================================================
   LOGIN API
===================================================== */

app.post("/api/login", async (req, res) => {

    try {

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: "Email and password are required."
            });
        }

        const [users] = await db.execute(
            `SELECT id, full_name, email, date_of_birth, blood_group
             FROM users
             WHERE email = ? AND password = ?`,
            [email, password]
        );

        if (users.length === 0) {

            return res.status(401).json({
                error: "Invalid email or password."
            });

        }

        const user = users[0];

        res.json({
            message: "Login successful.",
            user: user
        });

    } catch (error) {

        console.error(
            "Login Error:",
            error
        );

        res.status(500).json({
            error: "Unable to login."
        });

    }

});


/* =====================================================
   AI CHAT API
===================================================== */

app.post("/api/chat", async (req, res) => {

    try {

        const {
            message,
            healthData,
            userEmail
        } = req.body;


        if (!message || !message.trim()) {

            return res.status(400).json({
                error: "Message is required."
            });

        }


        if (!userEmail) {

            return res.status(401).json({
                error: "User is not logged in."
            });

        }


        // Find the logged-in user
        const [users] = await db.execute(
            `SELECT id
             FROM users
             WHERE email = ?`,
            [userEmail]
        );


        if (users.length === 0) {

            return res.status(404).json({
                error: "User account not found."
            });

        }


        const userId = users[0].id;

        // =====================================================
        // CHECK DAILY AI USAGE LIMIT
        // =====================================================

        const DAILY_LIMIT = 20;

        const [usageRows] = await db.execute(
            `SELECT request_count, last_request_at
     FROM ai_usage
     WHERE user_id = ?`,
            [userId]
        );

        let requestCount = 0;
        let lastRequestAt = null;

        if (usageRows.length > 0) {

            requestCount = usageRows[0].request_count;
            lastRequestAt = usageRows[0].last_request_at;

        }


        // Check whether 24 hours have passed
        if (lastRequestAt) {

            const lastRequestTime =
                new Date(lastRequestAt).getTime();

            const currentTime =
                Date.now();

            const hoursPassed =
                (currentTime - lastRequestTime) /
                (1000 * 60 * 60);


            if (hoursPassed >= 24) {

                requestCount = 0;

                await db.execute(
                    `UPDATE ai_usage
             SET request_count = 0,
                 last_request_at = NULL
             WHERE user_id = ?`,
                    [userId]
                );

            }

        }


        // Stop if daily limit reached
        if (requestCount >= DAILY_LIMIT) {

            return res.status(429).json({
                error:
                    "Daily AI limit reached. Please try again after 24 hours."
            });

        }

        // Save user's message
        await db.execute(
            `INSERT INTO chat_messages
             (user_id, role, message)
             VALUES (?, 'user', ?)`,
            [userId, message.trim()]
        );

        // =====================================================
        // UPDATE AI USAGE
        // =====================================================

        if (usageRows.length === 0) {

            await db.execute(
                `INSERT INTO ai_usage
         (user_id, request_count, last_request_at)
         VALUES (?, 1, NOW())`,
                [userId]
            );

        } else {

            await db.execute(
                `UPDATE ai_usage
         SET request_count = request_count + 1,
             last_request_at = NOW()
         WHERE user_id = ?`,
                [userId]
            );

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


        // // Ask Gemini
        // const interaction =
        //     await ai.interactions.create({

        //         model: "gemini-3.6-flash",

        //         input: prompt,

        //         generation_config: {
        //             thinking_level: "low"
        //         }

        //     });


        // const reply =
        //     interaction.output_text;

        // Ask Groq
        const completion =
            await groq.chat.completions.create({

                model: "openai/gpt-oss-20b",

                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],

                temperature: 0.3,

                max_tokens: 1000

            });


        const reply =
            completion.choices[0].message.content;


        // Save AI's response
        await db.execute(
            `INSERT INTO chat_messages
             (user_id, role, message)
             VALUES (?, 'assistant', ?)`,
            [userId, reply]
        );


        // Send response to frontend
        res.json({
            reply: reply
        });


    } catch (error) {

        console.error(
            "AI Chat Error:",
            error
        );


        res.status(500).json({
            error: "Unable to get a response from the AI."
        });

    }

});


/* =====================================================
   START SERVER
===================================================== */

db.getConnection()
    .then(connection => {
        console.log("MySQL database connected successfully.");
        connection.release();
    })
    .catch(error => {
        console.error("MySQL connection failed:", error.message);
    });



const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `HealthGuide AI server running on port ${PORT}`
    );
});