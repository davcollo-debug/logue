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

  const { messages, goalData } = req.body;

  try {
    const systemPrompt = `You are Logue, an AI running coach. You're having an onboarding conversation to understand the user's goal.

Your job:
1. Ask natural, conversational questions to learn about their running goal
2. Extract structured data from their responses
3. Confirm understanding before moving on

Required information:
- goalType: (e.g., "marathon", "half-marathon", "10k", "ultramarathon", "general fitness")
- distance: in kilometers (e.g., 42.2 for marathon)
- targetDate: ISO format (e.g., "2025-06-15")
- targetTime: optional, in format "HH:MM:SS" (e.g., "3:59:59")

Current goal data collected: ${JSON.stringify(goalData || {})}

Conversation rules:
- Be warm and encouraging
- Ask ONE question at a time
- If they give multiple pieces of info at once, acknowledge all of it
- Always confirm details before marking as complete
- If something is unclear, ask for clarification
- When you have all required info, confirm the full goal and respond with "GOAL_COMPLETE"

Example flow:
User: "I want to run a marathon"
You: "That's awesome! When are you planning to run this marathon?"
User: "June 15th next year"
You: "Great! Do you have a target time in mind, or are you focused on just finishing?"
User: "I want to break 4 hours"
You: "Perfect! Let me confirm: You're training for a marathon on June 15, 2025, with a goal of sub-4 hours. Is that right?"
User: "Yes"
You: "GOAL_COMPLETE: {\"goalType\": \"marathon\", \"distance\": 42.2, \"targetDate\": \"2025-06-15\", \"targetTime\": \"3:59:59\"}"`;

    const cleanMessages = messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    const response = await fetch(`${process.env.API_BASE || 'https://logue.vercel.app'}/api/claude-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: systemPrompt,
        max_tokens: 500,
        messages: cleanMessages
      })
    });

    const data = await response.json();
    const reply = data.content.find(c => c.type === 'text')?.text || 'Error in conversation.';
    
    const isComplete = reply.includes('GOAL_COMPLETE');
    let extractedGoal = null;
    
    if (isComplete) {
      const jsonMatch = reply.match(/\{[^}]+\}/);
      if (jsonMatch) {
        try {
          // Try parsing directly - Claude gives us valid JSON
          extractedGoal = JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error('Failed to parse goal JSON:', e, 'Original:', jsonMatch[0]);
        }
      }
      const cleanReply = reply.replace(/GOAL_COMPLETE:?\s*\{[^}]+\}/, '').trim();
      return res.status(200).json({ 
        reply: cleanReply, 
        isComplete: true, 
        goalData: extractedGoal 
      });
    }
    
    return res.status(200).json({ 
      reply: reply, 
      isComplete: false, 
      goalData: null 
    });
    
  } catch (error) {
    console.error('Goal intake error:', error);
    return res.status(500).json({ error: error.message });
  }
};
