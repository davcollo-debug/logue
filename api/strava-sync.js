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
    // Fetch activities list
    const response = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=30', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch Strava activities');
    }

    const activities = await response.json();
    const runningActivities = [];
    
    // Process each running activity
    for (const activity of activities) {
      if (activity.type === 'Run') {
        // Fetch detailed streams for this activity
        const streamsResponse = await fetch(
          `https://www.strava.com/api/v3/activities/${activity.id}/streams?keys=time,heartrate,cadence,distance,velocity_smooth,altitude&key_by_type=true`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        
        let detailedAnalysis = null;
        
        if (streamsResponse.ok) {
          const streams = await streamsResponse.json();
          detailedAnalysis = analyzeActivityStreams(streams, activity);
        }
        
        const activityData = {
          stravaId: activity.id,
          name: activity.name,
          distance: (activity.distance / 1000).toFixed(2),
          pace: formatPace(activity.average_speed),
          avgHeartrate: activity.average_heartrate || 0,
          maxHeartrate: activity.max_heartrate || 0,
          cadence: activity.average_cadence ? Math.round(activity.average_cadence * 2) : 0,
          date: activity.start_date,
          movingTime: activity.moving_time,
          // Add detailed analysis
          detailedAnalysis: detailedAnalysis
        };
        
        runningActivities.push(activityData);
      }
    }
    
    return res.status(200).json({ 
      activities: runningActivities,
      count: runningActivities.length 
    });
    
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: error.message });
  }
};

function analyzeActivityStreams(streams, activity) {
  const analysis = {};
  
  // Extract stream data
  const time = streams.time?.data || [];
  const heartrate = streams.heartrate?.data || [];
  const cadence = streams.cadence?.data || [];
  const distance = streams.distance?.data || [];
  const velocity = streams.velocity_smooth?.data || [];
  const altitude = streams.altitude?.data || [];
  
  if (time.length === 0) return null;
  
  // 1. HR DRIFT ANALYSIS (Aerobic Decoupling)
  if (heartrate.length > 0) {
    const firstHalfHR = calculateAverage(heartrate.slice(0, Math.floor(heartrate.length / 2)));
    const secondHalfHR = calculateAverage(heartrate.slice(Math.floor(heartrate.length / 2)));
    const hrDrift = ((secondHalfHR - firstHalfHR) / firstHalfHR * 100).toFixed(1);
    
    analysis.hrDrift = {
      firstHalf: Math.round(firstHalfHR),
      secondHalf: Math.round(secondHalfHR),
      driftPercentage: parseFloat(hrDrift),
      interpretation: parseFloat(hrDrift) > 5 ? 'significant_drift' : parseFloat(hrDrift) > 2 ? 'moderate_drift' : 'good_aerobic_efficiency'
    };
    
    // HR zones (assuming max HR of 190 for now - ideally get from user)
    const maxHR = activity.max_heartrate || 190;
    const zones = {
      zone1: 0, zone2: 0, zone3: 0, zone4: 0, zone5: 0
    };
    
    heartrate.forEach(hr => {
      const percentage = (hr / maxHR) * 100;
      if (percentage < 60) zones.zone1++;
      else if (percentage < 70) zones.zone2++;
      else if (percentage < 80) zones.zone3++;
      else if (percentage < 90) zones.zone4++;
      else zones.zone5++;
    });
    
    const totalPoints = heartrate.length;
    analysis.hrZones = {
      zone1_percent: ((zones.zone1 / totalPoints) * 100).toFixed(1),
      zone2_percent: ((zones.zone2 / totalPoints) * 100).toFixed(1),
      zone3_percent: ((zones.zone3 / totalPoints) * 100).toFixed(1),
      zone4_percent: ((zones.zone4 / totalPoints) * 100).toFixed(1),
      zone5_percent: ((zones.zone5 / totalPoints) * 100).toFixed(1)
    };
  }
  
  // 2. PACE CONSISTENCY (Splits Analysis)
  if (velocity.length > 0 && distance.length > 0) {
    const totalDistance = distance[distance.length - 1];
    const firstHalfDistance = totalDistance / 2;
    
    // Find index where we hit half distance
    let halfwayIndex = 0;
    for (let i = 0; i < distance.length; i++) {
      if (distance[i] >= firstHalfDistance) {
        halfwayIndex = i;
        break;
      }
    }
    
    const firstHalfPace = calculateAverage(velocity.slice(0, halfwayIndex));
    const secondHalfPace = calculateAverage(velocity.slice(halfwayIndex));
    
    const paceVariation = ((secondHalfPace - firstHalfPace) / firstHalfPace * 100).toFixed(1);
    
    analysis.paceConsistency = {
      firstHalfPace: formatPace(firstHalfPace),
      secondHalfPace: formatPace(secondHalfPace),
      variationPercentage: parseFloat(paceVariation),
      splitType: parseFloat(paceVariation) < -5 ? 'positive_split' : parseFloat(paceVariation) > 5 ? 'negative_split' : 'even_split'
    };
    
    // Calculate coefficient of variation for pace
    const paceStdDev = calculateStdDev(velocity);
    const paceMean = calculateAverage(velocity);
    const paceCV = ((paceStdDev / paceMean) * 100).toFixed(1);
    
    analysis.paceVariability = {
      coefficientOfVariation: parseFloat(paceCV),
      interpretation: parseFloat(paceCV) < 5 ? 'very_consistent' : parseFloat(paceCV) < 10 ? 'consistent' : 'variable'
    };
  }
  
  // 3. CADENCE STABILITY (Form Breakdown)
  if (cadence.length > 0) {
    const firstHalfCadence = calculateAverage(cadence.slice(0, Math.floor(cadence.length / 2)));
    const secondHalfCadence = calculateAverage(cadence.slice(Math.floor(cadence.length / 2)));
    const cadenceDrop = firstHalfCadence - secondHalfCadence;
    
    analysis.cadenceStability = {
      firstHalf: Math.round(firstHalfCadence * 2), // Double for steps per minute
      secondHalf: Math.round(secondHalfCadence * 2),
      drop: Math.round(cadenceDrop * 2),
      interpretation: cadenceDrop > 5 ? 'significant_form_breakdown' : cadenceDrop > 2 ? 'minor_form_fatigue' : 'stable_form'
    };
  }
  
  // 4. CARDIAC EFFICIENCY (Pace/HR relationship)
  if (heartrate.length > 0 && velocity.length > 0) {
    // Calculate efficiency score: how much speed per heartbeat
    const efficiencyScores = [];
    for (let i = 0; i < Math.min(heartrate.length, velocity.length); i++) {
      if (heartrate[i] > 0) {
        efficiencyScores.push(velocity[i] / heartrate[i]);
      }
    }
    
    const avgEfficiency = calculateAverage(efficiencyScores);
    const firstHalfEfficiency = calculateAverage(efficiencyScores.slice(0, Math.floor(efficiencyScores.length / 2)));
    const secondHalfEfficiency = calculateAverage(efficiencyScores.slice(Math.floor(efficiencyScores.length / 2)));
    const efficiencyDecline = ((firstHalfEfficiency - secondHalfEfficiency) / firstHalfEfficiency * 100).toFixed(1);
    
    analysis.cardiacEfficiency = {
      declinePercentage: parseFloat(efficiencyDecline),
      interpretation: parseFloat(efficiencyDecline) > 10 ? 'poor_efficiency' : parseFloat(efficiencyDecline) > 5 ? 'declining_efficiency' : 'good_efficiency'
    };
  }
  
  // 5. ELEVATION IMPACT
  if (altitude.length > 0) {
    const elevationGain = calculateElevationGain(altitude);
    analysis.elevationImpact = {
      totalGain: Math.round(elevationGain),
      avgGradient: ((elevationGain / (distance[distance.length - 1])) * 100).toFixed(2)
    };
  }
  
  return analysis;
}

function calculateAverage(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function calculateStdDev(arr) {
  const avg = calculateAverage(arr);
  const squareDiffs = arr.map(val => Math.pow(val - avg, 2));
  const avgSquareDiff = calculateAverage(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

function calculateElevationGain(altitude) {
  let gain = 0;
  for (let i = 1; i < altitude.length; i++) {
    const diff = altitude[i] - altitude[i - 1];
    if (diff > 0) gain += diff;
  }
  return gain;
}

function formatPace(metersPerSecond) {
  if (!metersPerSecond) return '0:00';
  const minPerKm = 1000 / (metersPerSecond * 60);
  const minutes = Math.floor(minPerKm);
  const seconds = Math.round((minPerKm - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
