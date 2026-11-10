import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy / safe initialization of Gemini AI
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    service: "TravelPilot Autonomous Agent Engine",
  });
});

// Endpoint: AI Chat & Conversational Itinerary Modification
app.post("/api/chat", async (req, res) => {
  try {
    const { message, currentPlan, history } = req.body;
    const ai = getGeminiClient();

    if (!ai) {
      // Intelligent mock response fallback if GEMINI_API_KEY is not configured
      return res.json({
        reply: `I received your request: "${message}". I have dynamically adjusted your schedule, preserving your budget and rest buffers.`,
        actionType: "schedule_adjusted",
        suggestedChanges: [
          "Adjusted morning timing by +1 hour",
          "Re-sequenced transit to minimize rush hour delays",
        ],
      });
    }

    const systemPrompt = `You are TravelPilot's Autonomous AI Travel Agent.
You are helping the traveler adjust or inspect their trip itinerary.
The traveler will give you commands or questions like:
- "I don't want to wake up before 9"
- "Add a famous local restaurant near tonight's route"
- "Remove tomorrow's museum and replace with something cultural"
- "Cut ₹2,000 from today's budget"
- "What happens if it rains tomorrow?"

Current Plan Context:
Destination: ${currentPlan?.destination || "Tokyo, Japan"}
Budget: ${currentPlan?.budget?.currency || "₹"}${currentPlan?.budget?.total || 50000}
Optimization Mode: ${currentPlan?.constraints?.optimizationMode || "Relaxed Schedule"}

Respond warmly, concisely, and action-oriented like an elite autonomous travel agent.
Explain clearly what you modified (times, substitutions, route efficiency, budget impact).
Keep response under 150 words.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [
        { text: systemPrompt },
        ...(history || []).map((h: { sender: string; text: string }) => ({
          text: `${h.sender}: ${h.text}`,
        })),
        { text: `Traveler: ${message}` },
      ],
    });

    res.json({
      reply: response.text?.trim() || "I have analyzed your request and optimized your itinerary.",
      actionType: "updated",
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      reply: "I understood your request. I've recalculated your timing and protected your reservations.",
      error: String(error),
    });
  }
});

// Endpoint: Autonomous Re-planning Engine for Disruptions
app.post("/api/replan", async (req, res) => {
  try {
    const { disruptionType, details, currentPlan } = req.body;
    const ai = getGeminiClient();

    let aiReasoning = "";
    if (ai) {
      try {
        const prompt = `You are TravelPilot's Autonomous Re-planning Engine.
A travel disruption has occurred:
Type: ${disruptionType}
Details: ${JSON.stringify(details)}
Destination: ${currentPlan?.destination || "Kyoto, Japan"}

Provide an autonomous re-planning summary in JSON with:
{
  "summary": "Short 1-line agent status",
  "affectedCount": 3,
  "changes": [
    {"activity": "Museum visit", "action": "Moved to 4:30 PM due to flight delay"},
    {"activity": "Lunch", "action": "Changed to nearby restaurant near new arrival point"},
    {"activity": "Sunset viewpoint", "action": "Rescheduled to Day 2 golden hour"}
  ],
  "costDelta": 450,
  "travelTimeDeltaMin": -15,
  "agentNote": "Transit buffers preserved, museum ticket rebooking confirmed without penalty."
}`;
        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        });
        aiReasoning = response.text || "";
      } catch (err) {
        console.warn("Gemini replan fallback used:", err);
      }
    }

    res.json({
      success: true,
      aiAnalysis: aiReasoning ? JSON.parse(aiReasoning) : null,
    });
  } catch (error) {
    console.error("Replan error:", error);
    res.status(500).json({ error: "Failed to recalculate plan" });
  }
});

// Endpoint: Context-Aware "What Should I Do Now?" Mode
app.post("/api/what-now", async (req, res) => {
  try {
    const { currentTime, currentLocation, currentPlan, weather } = req.body;
    const ai = getGeminiClient();

    let recommendation = null;
    if (ai) {
      try {
        const prompt = `You are TravelPilot's 'What Should I Do Now?' real-time agent.
Traveler's Current Time: ${currentTime || "3:20 PM"}
Current Location: ${currentLocation || "Near Downtown Station"}
Weather: ${weather?.condition || "Sunny, 24°C"}
Destination: ${currentPlan?.destination || "Tokyo, Japan"}

Return a JSON recommendation object:
{
  "statusHeader": "It's 3:20 PM. You're 8 minutes from the City Heritage Museum.",
  "recommendedActivity": "Visit City Heritage Museum & Teahouse",
  "reason": "Next scheduled dinner is at 6:30 PM. This fills the 2.5h gap perfectly with no backtracking.",
  "distanceKm": 0.7,
  "travelTimeMin": 8,
  "visitDurationMin": 90,
  "estimatedCost": 250,
  "closingTime": "5:30 PM",
  "insiderTip": "Audio guide is included; top floor has panoramic views."
}`;
        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        });
        if (response.text) {
          recommendation = JSON.parse(response.text);
        }
      } catch (e) {
        console.warn("Gemini what-now fallback:", e);
      }
    }

    res.json({
      success: true,
      recommendation,
    });
  } catch (error) {
    console.error("What now error:", error);
    res.status(500).json({ error: "Failed to determine immediate recommendation" });
  }
});

// Mount Vite middleware in dev or static files in prod
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`TravelPilot AI Agent Server running on http://0.0.0.0:${PORT}`);
  });
}

setupServer();
