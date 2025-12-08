import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, token } = req.body;

  try {
    // Fetch activities from Strava
    const response = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=30', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch activities');
    }

    const activities = await response.json();
    
    // Store in Firestore
    const userRef = db.collection('users').doc(userId);
    const activitiesRef = userRef.collection('activities');
    
    const savedActivities = [];
    
    for (const activity of activities) {
      if (activity.type === 'Run') {
        const activityData = {
          stravaId: activity.id,
          name: activity.name,
          distance: (activity.distance / 1000).toFixed(2), // Convert to km
          pace: formatPace(activity.average_speed),
          avgHeartrate: activity.average_heartrate || 0,
          maxHeartrate: activity.max_heartrate || 0,
          cadence: activity.average_cadence ? Math.round(activity.average_cadence * 2) : 0,
          date: activity.start_date,
          movingTime: activity.moving_time
        };
        
        await activitiesRef.doc(activity.id.toString()).set(activityData);
        savedActivities.push(activityData);
      }
    }
    
    // Update last sync time
    await userRef.update({ lastSync: new Date().toISOString() });

    return res.status(200).json({ 
      activities: savedActivities,
      count: savedActivities.length 
    });
    
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function formatPace(metersPerSecond) {
  if (!metersPerSecond) return '0:00';
  const minPerKm = 1000 / (metersPerSecond * 60);
  const minutes = Math.floor(minPerKm);
  const seconds = Math.round((minPerKm - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
