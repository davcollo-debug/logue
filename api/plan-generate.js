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
Create a training plan from now until their goal date (${goalData.targetDate}).

First, provide the high-level structure as a JSON object (no markdown, just pure JSON):
{
  "totalWeeks": <number>,
  "phases": [
    {
      "name": "Base Building",
      "weeks": "1-4",
      "focus": "Building aerobic base",
      "weeklyVolume": "50-70km"
    }
  ]
}

Then, provide THIS WEEK's specific sessions (Week 1) in plain text:

**Monday**: Easy 8k run
- Keep HR below 145 bpm
- Purpose: Recovery and base building

**Wednesday**: Tempo 10k
- Target pace: 5:20-5:30/km
- Purpose: Building lactate threshold

(etc...)

Be specific with numbers. Make it appropriate for their current fitness.`;

    const response = await fetch(`${process.env.API_BASE || 'https://logue.vercel.app'}/api/claude-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_tokens: 2000,
        messages: [{ role: 'user', content: planPrompt }]
      })
    });

    const data = await response.json();
    let planText = data.content?.find(c => c.type === 'text')?.text || '';
    
    // Extract JSON structure
    const jsonMatch = planText.match(/\{[\s\S]*?"phases"[\s\S]*?\}/);
    let planStructure = null;
    
    if (jsonMatch) {
      try {
        let jsonStr = jsonMatch[0]
          .replace(/(\w+):/g, '"$1":')
          .replace(/'/g, '"');
        planStructure = JSON.parse(jsonStr);
        
        // Remove the JSON from the text output
        planText = planText.replace(jsonMatch[0], '').trim();
      } catch (e) {
        console.error('Failed to parse plan JSON:', e, 'Original:', jsonMatch[0]);
      }
    }
    
    // Clean up any markdown code blocks
    planText = planText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
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
