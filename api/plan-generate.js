module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { goalData, fitnessData } = req.body;

  try {
    const planPrompt = `You are Logue, an expert running coach. Create a personalized training plan.

GOAL:
${JSON.stringify(goalData, null, 2)}

FITNESS ASSESSMENT:
${fitnessData.assessment}

Recent training volume: ${Math.round(fitnessData.activities.reduce((sum, a) => sum + parseFloat(a.distance), 0) / 4)} km/week average

YOUR TASK:
Create a training plan from now until their goal date. Provide:

1. HIGH-LEVEL STRUCTURE (respond with JSON):
{
  "totalWeeks": <number>,
  "phases": [
    {
      "name": "Base Building",
      "weeks": "1-4",
      "focus": "Building aerobic base, establishing consistency",
      "weeklyVolume": "50-70km"
    },
    ...
  ]
}

2. THIS WEEK'S SESSIONS (Week 1):
Provide 4-5 specific sessions with:
- Day of week
- Session type (Easy/Tempo/Long/Recovery)
- Distance
- Pace guidance or HR zones
- Brief purpose

Be specific with numbers. Make it appropriate for their current fitness level.`;

    const response = await fetch(`${process.env.API_BASE || 'https://logue.vercel.app'}/api/claude-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_tokens: 2000,
        messages: [{ role: 'user', content: planPrompt }]
      })
    });

    const data = await response.json();
    const planText = data.content?.find(c => c.type === 'text')?.text || '';
    
    // Try to extract JSON structure
    const jsonMatch = planText.match(/\{[\s\S]*"phases"[\s\S]*\}/);
    let planStructure = null;
    
    if (jsonMatch) {
      try {
        planStructure = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('Failed to parse plan JSON:', e);
      }
    }
    
    return res.status(200).json({ 
      planText,
      planStructure
    });
    
  } catch (error) {
    console.error('Plan generation error:', error);
    return res.status(500).json({ 
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      error: error.message 
    });
  }
};
