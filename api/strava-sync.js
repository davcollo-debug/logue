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

  const { token } = req.body;

  try {
    const response = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=30', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch Strava activities');
    }

    const activities = await response.json();
    
    // Filter and format running activities
    const runningActivities = activities
      .filter(a => a.type === 'Run')
      .map(activity => ({
        stravaId: activity.id,
        name: activity.name,
        distance: (activity.distance / 1000).toFixed(2),
        pace: formatPace(activity.average_speed),
        avgHeartrate: activity.average_heartrate || 0,
        maxHeartrate: activity.max_heartrate || 0,
        cadence: activity.average_cadence ? Math.round(activity.average_cadence * 2) : 0,
        date: activity.start_date,
        movingTime: activity.moving_time
      }));
    
    return res.status(200).json({ 
      activities: runningActivities,
      count: runningActivities.length 
    });
    
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: error.message });
  }
};

function formatPace(metersPerSecond) {
  if (!metersPerSecond) return '0:00';
  const minPerKm = 1000 / (metersPerSecond * 60);
  const minutes = Math.floor(minPerKm);
  const seconds = Math.round((minPerKm - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
