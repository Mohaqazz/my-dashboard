'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Upload, RotateCcw, Zap, ZapOff, Radio } from 'lucide-react';

// Complete NetworkSimulator with all your Python calculations
class NetworkSimulator {
  constructor() {
    this.networkParams = {
      rateEfficiency: 0.95,
      noisePowerDBm: -110,
      coverageThresholdDBm: -120,
      maxRuLoad: 0.9
    };

    this.bsParams = {
      txPowerDBm: 30,
      bandwidthHz: 20000000,
      frequencyHz: 3500000000,
      pMax: 200,
      pIdle: 30,
      heightM: 10,
      coverageRadiusKm: 0.3,
      sectors: 1
    };

    this.ueParams = {
      requiredRateBps: 1000000,
      priority: 2,
      heightM: 1.5
    };

    this.bsCoordinates = [
      [-85, -115, 37], [144, -135, 40], [-72, 25, 39],
    [72, -15, 38], [-114, 125, 37], [144, 125, 38]
    ];

    this._initializeBaseStations();
    this._initializeTracking();
  }

  _initializeBaseStations() {
    this.cellCount = this.bsCoordinates.length;
    this.cellPositions = [...this.bsCoordinates];
    this.cellClass = new Array(this.cellCount).fill(1);
    this.cellBandwidth = new Array(this.cellCount).fill(this.bsParams.bandwidthHz);
    this.cellFreq = new Array(this.cellCount).fill(this.bsParams.frequencyHz);
    this.cellTxPower = new Array(this.cellCount).fill(this.bsParams.txPowerDBm);
    this.ruOn = new Array(this.cellCount).fill(true);

    const subcarrierSpacing = 30e3;
    const prbSize = 12 * subcarrierSpacing;
    this.cellPrbs = this.cellBandwidth.map(bw => Math.max(1, Math.floor(bw / prbSize)));
  }

  _initializeTracking() {
    this.isInitialized = false;
    this.previousAssociation = null;
    this.handoverCount = 0;
    this.totalHandoverCost = 0.0;
    this.currentTimeStep = 0;
    this.previousUeRxPower = null;
    this.previousUeRate = null;
    this.ueHandoverTimer = {};
    this.energyTrajectory = [];
    this.qosTrajectory = [];
    this.handoverTrajectory = [];
  }

  run(ueData, bsStatus = null, isInitial = null) {
    if (bsStatus !== null) {
      this.ruOn = [...bsStatus];
    }

    if (isInitial === null) {
      isInitial = !this.isInitialized;
    }

    this._loadUeData(ueData);
    this._initializeRuntimeArrays();
    this._computeRxPower();
    this._associateInitial();
    this._allocatePrbs();
    this._computeSnrRateOutage();
    this._calculateCellLoad();
    this._computeEnergy();
    this._generateMetrics();
    this._updateTrajectories();
  }

  _loadUeData(ueData) {
    this.uePositions = ueData.map(ue => [ue.x, ue.y, ue.z || this.ueParams.heightM]);
    this.ueCount = this.uePositions.length;
    this.ueClass = new Array(this.ueCount).fill(1);
    this.ueIds = ueData.map((ue, index) => ue.ue_id !== undefined ? ue.ue_id : index);
  }

  _initializeRuntimeArrays() {
    this.uePrbs = new Array(this.ueCount).fill(0);
    this.cellRate = new Array(this.cellCount).fill(0);
    this.cellLoad = new Array(this.cellCount).fill(0);
    this.ueSnr = new Array(this.ueCount).fill(0);
    this.ueRate = new Array(this.ueCount).fill(0);
    this.ueOutage = new Array(this.ueCount).fill(false);
    this.ueRxPower = Array(this.cellCount).fill().map(() => new Array(this.ueCount).fill(0));
  }

  _computeRxPower() {
    for (let r = 0; r < this.cellCount; r++) {
      for (let u = 0; u < this.ueCount; u++) {
        const bsPos = this.cellPositions[r];
        const uePos = this.uePositions[u];

        const distance2d = Math.sqrt(
          Math.pow(bsPos[0] - uePos[0], 2) +
          Math.pow(bsPos[1] - uePos[1], 2)
        );

        const frequencyGhz = this.cellFreq[r] / 1e9;
        const pathLoss = this._umiPathLoss(distance2d, frequencyGhz);
        this.ueRxPower[r][u] = this.cellTxPower[r] - pathLoss;
      }
    }
  }

  _umiPathLoss(d2d, fc, hBs = 10, hUe = 1.75) {
    const dBp = 4 * hBs * hUe * (fc / 0.3);
    const d3d = Math.sqrt(d2d * d2d + Math.pow(hBs - hUe, 2));

    let prLos;
    if (d2d <= 18) {
      prLos = 1;
    } else {
      prLos = (18 / d2d) + (Math.exp(-d2d / 36) * (1 - (18 / d2d)));
    }

    const prNonLos = 1 - prLos;

    let pathLossLos;
    if (d2d <= dBp) {
      pathLossLos = 32.4 + 21 * Math.log10(d3d) + 20 * Math.log10(fc);
    } else {
      pathLossLos = 32.4 + 40 * Math.log10(d3d) + 20 * Math.log10(fc) -
                    9.5 * Math.log10(dBp * dBp + Math.pow(hBs - hUe, 2));
    }

    const pl = 22.4 + 35.3 * Math.log10(d3d) + 21.3 * Math.log10(fc) - 0.3 * (hUe - 1.5);
    const pathLossNonLos = Math.max(pathLossLos, pl);

    return prLos * pathLossLos + prNonLos * pathLossNonLos;
  }

  _associateInitial() {
    const maskedPower = this.ueRxPower.map((row, r) =>
      this.ruOn[r] ? [...row] : new Array(this.ueCount).fill(-Infinity)
    );

    this.association = new Array(this.ueCount);
    for (let u = 0; u < this.ueCount; u++) {
      let maxPower = -Infinity;
      let bestRu = 0;
      for (let r = 0; r < this.cellCount; r++) {
        if (maskedPower[r][u] > maxPower) {
          maxPower = maskedPower[r][u];
          bestRu = r;
        }
      }
      this.association[u] = bestRu;
    }
  }

  _allocatePrbs() {
    this.uePrbs.fill(0);

    for (let r = 0; r < this.cellCount; r++) {
      if (!this.ruOn[r]) continue;

      const ueIndices = [];
      for (let u = 0; u < this.ueCount; u++) {
        if (this.association[u] === r) {
          ueIndices.push(u);
        }
      }

      if (ueIndices.length === 0) continue;

      const prbsNeeded = [];

      for (const ue of ueIndices) {
        const snrLinear = Math.pow(10, this.ueSnr[ue] / 10);
        const spectralEfficiency = Math.log2(1 + snrLinear);
        const prbBandwidth = 12 * 30e3;
        const prbCapacityBps = prbBandwidth * spectralEfficiency * this.networkParams.rateEfficiency;

        let requiredPrbs;
        if (prbCapacityBps > 0) {
          requiredPrbs = Math.max(1, Math.ceil(this.ueParams.requiredRateBps / prbCapacityBps));
        } else {
          requiredPrbs = this.cellPrbs[r];
        }

        prbsNeeded.push(Math.floor(requiredPrbs));
      }

      let remainingPrbs = this.cellPrbs[r];

      for (let i = 0; i < ueIndices.length; i++) {
        const ue = ueIndices[i];
        const needed = prbsNeeded[i];
        if (remainingPrbs >= needed) {
          this.uePrbs[ue] = needed;
          remainingPrbs -= needed;
        } else if (remainingPrbs > 0) {
          this.uePrbs[ue] = remainingPrbs;
          remainingPrbs = 0;
          break;
        }
      }
    }
  }

  _computeSnrRateOutage() {
    if (this.association.length !== this.ueCount) {
      this._associateInitial();
    }

    const rxPowerDBm = this.association.map((ru, ue) => this.ueRxPower[ru][ue]);
    this.ueSnr = rxPowerDBm.map(power => power - this.networkParams.noisePowerDBm);

    this.ueRate = this.ueSnr.map((snr, ue) => {
      const spectralEfficiency = Math.log2(1 + Math.pow(10, snr / 10));
      return this.uePrbs[ue] * this.networkParams.rateEfficiency * 12 * 15e3 * spectralEfficiency;
    });

    this.ueOutage = this.ueRate.map(rate => rate < this.ueParams.requiredRateBps);
  }

  _calculateCellLoad() {
    this.cellRate.fill(0);
    this.cellLoad.fill(0);

    for (let r = 0; r < this.cellCount; r++) {
      let usedPrbs = 0;
      let totalRate = 0;

      for (let u = 0; u < this.ueCount; u++) {
        if (this.association[u] === r) {
          usedPrbs += this.uePrbs[u];
          totalRate += this.ueRate[u];
        }
      }

      this.cellLoad[r] = usedPrbs / Math.max(this.cellPrbs[r], 1);
      this.cellRate[r] = totalRate;
    }
  }

  _computeEnergy() {
    this.ruPowerDraw = new Array(this.cellCount);

    for (let r = 0; r < this.cellCount; r++) {
      if (!this.ruOn[r]) {
        this.ruPowerDraw[r] = 0.0;
        continue;
      }

      const pIdle = this.bsParams.pIdle;
      const pMax = this.bsParams.pMax;
      const rho = this.cellLoad[r];

      if (rho === 0) {
        this.ruPowerDraw[r] = pIdle;
      } else {
        const powerFactor = 1.0 + 0.3 * rho;
        this.ruPowerDraw[r] = pIdle + powerFactor * rho * (pMax - pIdle);
      }
    }
  }

  _generateMetrics() {
    this.ueMetrics = this.ueIds.map((id, i) => ({
      UE_ID: id,
      Class: this.ueClass[i],
      Serving_RU: this.association[i],
      Rx_Power_dBm: this.ueRxPower[this.association[i]][i],
      SNR_dB: this.ueSnr[i],
      Rate_Mbps: this.ueRate[i] / 1e6,
      Outage: this.ueOutage[i] ? 1 : 0,
      PRBs_Allocated: this.uePrbs[i]
    }));

    const ueCountsPerRu = new Array(this.cellCount).fill(0);
    for (const ru of this.association) {
      ueCountsPerRu[ru]++;
    }

    this.ruMetrics = Array.from({ length: this.cellCount }, (_, i) => ({
      RU_ID: i,
      Class: this.cellClass[i],
      Bandwidth_MHz: this.cellBandwidth[i] / 1e6,
      Total_PRBs: this.cellPrbs[i],
      Load: this.cellLoad[i],
      Throughput_Mbps: this.cellRate[i] / 1e6,
      Power_Watts: this.ruPowerDraw[i],
      Power_State: this.ruOn[i] ? "ON" : "OFF",
      Connected_UEs: ueCountsPerRu[i],
      Efficiency_Mbps_per_W: this.ruPowerDraw[i] > 0 ? (this.cellRate[i] / 1e6) / this.ruPowerDraw[i] : 0
    }));

    const totalThroughput = this.cellRate.reduce((sum, rate) => sum + rate, 0) / 1e6;
    const totalPower = this.ruPowerDraw.reduce((sum, power) => sum + power, 0);
    const systemOutage = this.ueOutage.length > 0 ?
      this.ueOutage.filter(Boolean).length / this.ueOutage.length : 0;

    this.systemMetrics = {
      Total_Throughput_Mbps: totalThroughput,
      Total_Energy_Watts: totalPower,
      System_Outage: systemOutage,
      QoS_Satisfaction: 1 - systemOutage,
      Active_RUs: this.ruOn.filter(Boolean).length,
      Total_RUs: this.cellCount,
      Energy_Efficiency_Mbps_per_W: totalPower > 0 ? totalThroughput / totalPower : 0,
      Total_Handover_Cost: this.totalHandoverCost,
      Handover_Count: this.handoverCount
    };

    this.previousAssociation = [...this.association];
    this.previousUeRxPower = this.ueRxPower.map(row => [...row]);
    this.previousUeRate = [...this.ueRate];
    this.isInitialized = true;
    this.currentTimeStep++;
  }

  _updateTrajectories() {
    this.energyTrajectory.push(this.systemMetrics.Total_Energy_Watts);
    this.qosTrajectory.push(this.systemMetrics.QoS_Satisfaction);
    this.handoverTrajectory.push(this.systemMetrics.Total_Handover_Cost);
  }

  setBSStatus(bsStatusArray) {
    this.ruOn = [...bsStatusArray];
    return { success: true, bsStatus: this.ruOn };
  }
}

const NetworkDashboard = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mobilityData, setMobilityData] = useState([]);
  const [agentMode, setAgentMode] = useState(false);
  const [bsStatus, setBsStatus] = useState([true, true, true, true, true, true]);
  const [metrics, setMetrics] = useState(null);
  const [maxTime, setMaxTime] = useState(0);
  const [simulationSpeed, setSimulationSpeed] = useState(1.0);
  const [lastMetricsUpdate, setLastMetricsUpdate] = useState(0);
  const [mapReady, setMapReady] = useState(false);

// Agent Configuration
const AGENT_CONFIG = {
  agent_one: {
    url: 'http://localhost:5000',  // Replace with Agent One URL
    name: 'Agent One (Monitor)',
    receives_kpis: true,
    sends_actions: false
  },
  agent_two: {
    url: 'http://localhost:5000',  // Replace with Agent Two URL  
    name: 'Agent Two (Controller)',
    receives_kpis: true,
    sends_actions: true
  }
};

// Performance thresholds
const PERFORMANCE_THRESHOLDS = {
  outage_threshold: 0.95,           // Emergency trigger if System_Outage > 0.95
  emergency_cooldown_ms: 3000       // 3 seconds minimum between emergency sends
};

// Add emergency tracking state
const [lastEmergencyKpiSend, setLastEmergencyKpiSend] = useState(0);
const [emergencyTriggered, setEmergencyTriggered] = useState(false);

  const intervalRef = useRef(null);
  const fileInputRef = useRef(null);
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef = useRef({ bs: [], ues: [] });
  const networkSimulator = useRef(new NetworkSimulator());

  const LEEDS_CENTER = { lat: 53.796211, lng: -1.547190 };

  const bsCoordinates = [
    [-85, -115, 37], [144, -135, 40], [-72, 25, 39],
    [72, -15, 38], [-114, 125, 37], [144, 125, 38]
  ];

  const metersToGPS = useCallback((x, y) => {
    const latPerMeter = 1 / 111320;
    const lonPerMeter = 1 / (111320 * Math.cos(LEEDS_CENTER.lat * Math.PI / 180));

    return {
      lat: LEEDS_CENTER.lat + (y * latPerMeter),
      lng: LEEDS_CENTER.lng + (x * lonPerMeter)
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
    script.onload = () => {
      try {
        if (typeof window.L === 'undefined') return;

        leafletMapRef.current = window.L.map(mapRef.current).setView([LEEDS_CENTER.lat, LEEDS_CENTER.lng], 15);

        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(leafletMapRef.current);

        const createBSIcon = (isActive) => window.L.divIcon({
          className: 'custom-div-icon',
          html: `<div style="
            background: ${isActive ? 'linear-gradient(135deg, #10B981, #059669)' : 'linear-gradient(135deg, #EF4444, #DC2626)'};
            width: 20px; height: 20px; border-radius: 4px; border: 2px solid white;
            box-shadow: 0 3px 8px rgba(0,0,0,0.4); position: relative;
          ">
            <div style="position: absolute; top: -8px; left: 50%; transform: translateX(-50%);
              width: 2px; height: 8px; background: #1F2937;"></div>
          </div>`,
          iconSize: [24, 24], iconAnchor: [12, 12]
        });

        bsCoordinates.forEach((coord, index) => {
          const gpsCoords = metersToGPS(coord[0], coord[1]);
          const marker = window.L.marker([gpsCoords.lat, gpsCoords.lng], {
            icon: createBSIcon(bsStatus[index])
          })
          .addTo(leafletMapRef.current)
          .bindPopup(`<div style="text-align: center; padding: 8px;">
            <strong>📡 BS ${index + 1}</strong><br>
            Position: (${coord[0]}, ${coord[1]})m<br>
            Status: ${bsStatus[index] ? 'Active' : 'Inactive'}
          </div>`);

          markersRef.current.bs[index] = marker;
        });

        setMapReady(true);
      } catch (error) {
        console.error('Error initializing map:', error);
      }
    };

    document.head.appendChild(script);

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [metersToGPS, bsStatus]);

  useEffect(() => {
    if (networkSimulator.current) {
      try {
        networkSimulator.current.run([], bsStatus, true);
        setMetrics({
          systemMetrics: networkSimulator.current.systemMetrics,
          ruMetrics: networkSimulator.current.ruMetrics,
          ueMetrics: networkSimulator.current.ueMetrics
        });
      } catch (error) {
        console.error('Initialization error:', error);
      }
    }
  }, [bsStatus]);

  const handleFileUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n').filter(line => line.trim());
        const headers = lines[0].split(',').map(h => h.trim());

        const data = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          if (values.length === headers.length) {
            const row = {};
            headers.forEach((header, index) => {
              row[header] = isNaN(values[index]) ? values[index] : parseFloat(values[index]);
            });
            data.push(row);
          }
        }

        setMobilityData(data);
        const times = [...new Set(data.map(d => d.time))].sort((a, b) => a - b);
        setMaxTime(Math.max(...times));
        setCurrentTime(Math.min(...times));

        console.log(`Loaded ${data.length} mobility records`);
      } catch (error) {
        console.error('Error parsing CSV:', error);
        alert('Error parsing CSV file. Please check the format.');
      }
    };
    reader.readAsText(file);
  }, []);

  const getCurrentUEs = useCallback(() => {
    if (!mobilityData.length) return [];
    return mobilityData.filter(ue => ue.time === currentTime);
  }, [mobilityData, currentTime]);

  const updateSimulationMetrics = useCallback((currentUEs) => {
    if (!networkSimulator.current) return;

    try {
      networkSimulator.current.setBSStatus(bsStatus);
      networkSimulator.current.run(currentUEs, bsStatus, false);

      setMetrics({
        systemMetrics: networkSimulator.current.systemMetrics,
        ruMetrics: networkSimulator.current.ruMetrics,
        ueMetrics: networkSimulator.current.ueMetrics
      });
    } catch (error) {
      console.error('Simulation error:', error);
    }
  }, [bsStatus]);

  useEffect(() => {
    if (!leafletMapRef.current || !mapReady) return;

    markersRef.current.ues.forEach(marker => {
      leafletMapRef.current.removeLayer(marker);
    });
    markersRef.current.ues = [];

    const currentUEs = getCurrentUEs();
    currentUEs.forEach(ue => {
      const gpsCoords = metersToGPS(ue.x, ue.y);

      const ueIcon = window.L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background: linear-gradient(135deg, #F59E0B, #D97706);
          width: 14px; height: 14px; border-radius: 50%; border: 2px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></div>`,
        iconSize: [18, 18], iconAnchor: [9, 9]
      });

      const marker = window.L.marker([gpsCoords.lat, gpsCoords.lng], { icon: ueIcon })
        .addTo(leafletMapRef.current)
        .bindPopup(`<div style="text-align: center; padding: 8px;">
          <strong>📱 UE ${ue.ue_id}</strong><br>
          Position: (${ue.x}, ${ue.y})m<br>Time: ${ue.time}s
        </div>`);

      markersRef.current.ues.push(marker);
    });
  }, [getCurrentUEs, metersToGPS, mapReady]);

  // REPLACE the existing useEffect (around line 350-360) with this:

useEffect(() => {
  if (currentTime > 0 && currentTime !== lastMetricsUpdate && currentTime % 5 === 0) {
    const currentUEs = getCurrentUEs();
    if (currentUEs.length > 0) {
      updateSimulationMetrics(currentUEs);
      setLastMetricsUpdate(currentTime);
      
      // NEW: Send KPIs to agent when agent mode is active
      if (agentMode) {
        setTimeout(sendKPIsToAgent, 500); // Small delay to ensure metrics are updated
      }
    }
  }
}, [currentTime, getCurrentUEs, updateSimulationMetrics, lastMetricsUpdate, agentMode]);

useEffect(() => {
  if (!agentMode || !metrics) return;

  const currentOutage = metrics.systemMetrics.System_Outage;
  const currentQoS = metrics.systemMetrics.QoS_Satisfaction;
  const now = Date.now();
  
  // Check if emergency conditions are met
  const isEmergencyCondition = currentOutage > PERFORMANCE_THRESHOLDS.outage_threshold;
  
  // Check cooldown period to prevent spam
  const isWithinCooldown = (now - lastEmergencyKpiSend) < PERFORMANCE_THRESHOLDS.emergency_cooldown_ms;
  
  if (isEmergencyCondition && !isWithinCooldown) {
    console.log(`🚨 EMERGENCY TRIGGERED: Outage ${(currentOutage * 100).toFixed(1)}% > ${(PERFORMANCE_THRESHOLDS.outage_threshold * 100)}%`);
    console.log(`📊 Current QoS: ${(currentQoS * 100).toFixed(1)}%`);
    
    // Set emergency state
    setEmergencyTriggered(true);
    
    // Send emergency KPIs immediately
    sendKPIsToAgent(true); // true = emergency send
    
    // Clear emergency state after a delay
    setTimeout(() => setEmergencyTriggered(false), 2000);
  }
  
}, [metrics, agentMode, lastEmergencyKpiSend, PERFORMANCE_THRESHOLDS]);

  useEffect(() => {
    if (!leafletMapRef.current || !mapReady) return;

    bsCoordinates.forEach((coord, index) => {
      if (markersRef.current.bs[index]) {
        const createBSIcon = (isActive) => window.L.divIcon({
          className: 'custom-div-icon',
          html: `<div style="
            background: ${isActive ? 'linear-gradient(135deg, #10B981, #059669)' : 'linear-gradient(135deg, #EF4444, #DC2626)'};
            width: 20px; height: 20px; border-radius: 4px; border: 2px solid white;
            box-shadow: 0 3px 8px rgba(0,0,0,0.4); position: relative;
          ">
            <div style="position: absolute; top: -8px; left: 50%; transform: translateX(-50%);
              width: 2px; height: 8px; background: #1F2937;"></div>
          </div>`,
          iconSize: [24, 24], iconAnchor: [12, 12]
        });

        markersRef.current.bs[index].setIcon(createBSIcon(bsStatus[index]));
      }
    });
  }, [bsStatus, mapReady]);

  const toggleBS = useCallback((bsIndex) => {
    if (agentMode) return;
    const newStatus = [...bsStatus];
    newStatus[bsIndex] = !newStatus[bsIndex];
    setBsStatus(newStatus);
  }, [agentMode, bsStatus]);

  const toggleSimulation = useCallback(() => {
    if (isRunning) {
      clearInterval(intervalRef.current);
      setIsRunning(false);
    } else {
      if (mobilityData.length === 0) {
        alert('Please upload mobility data first');
        return;
      }

      const intervalTime = 1000 / simulationSpeed;
      intervalRef.current = setInterval(() => {
        setCurrentTime(prevTime => {
          const times = [...new Set(mobilityData.map(d => d.time))].sort((a, b) => a - b);
          const currentIndex = times.indexOf(prevTime);
          const nextIndex = (currentIndex + 1) % times.length;
          return times[nextIndex];
        });
      }, intervalTime);
      setIsRunning(true);
    }
  }, [isRunning, mobilityData, simulationSpeed]);

  const resetSimulation = useCallback(() => {
    clearInterval(intervalRef.current);
    setIsRunning(false);
    setCurrentTime(0);
    setLastMetricsUpdate(0);
    setBsStatus([true, true, true, true, true, true]);
    setAgentMode(false);
    setSimulationSpeed(1.0);
  }, []);


// SEnding kpi function
const sendKPIsToAgent = async (isEmergency = false) => {
  if (!agentMode || !metrics) return;
  
  try {
    // Create per-BS data array in the format agents expect
    const perBsData = metrics.ruMetrics.map((ru, index) => {
      const prbUsed = Math.round(ru.Total_PRBs * ru.Load);
      const prbAvailable = ru.Total_PRBs - prbUsed;
      
      return {
        Time: currentTime,
        Cell_name: `BS_${ru.RU_ID + 1}`,
        UEThobDL: parseFloat(ru.Throughput_Mbps.toFixed(2)),
        PRBUSED_DL: prbUsed,
        PRB_AVAILABLE: prbAvailable,
        PRBTOTAL: ru.Total_PRBs,
        connected_UEs: ru.Connected_UEs,
        Power_State: ru.Power_State,
        Load_Percentage: parseFloat((ru.Load * 100).toFixed(1)),
        Power_Watts: parseFloat(ru.Power_Watts.toFixed(1))
      };
    });

    const kpiPayload = {
      timestamp: currentTime,
      bs_data: perBsData,
      total_ues: getCurrentUEs().length,
      system_metrics: {
        outage: metrics.systemMetrics.System_Outage,
        qos_satisfaction: metrics.systemMetrics.QoS_Satisfaction,
        total_throughput_mbps: metrics.systemMetrics.Total_Throughput_Mbps,
        total_power_watts: metrics.systemMetrics.Total_Energy_Watts
      },
      trigger_type: isEmergency ? 'emergency' : 'scheduled'
    };

    const sendType = isEmergency ? '🚨 EMERGENCY' : '📊 SCHEDULED';
    console.log(`${sendType} KPIs to both agents:`, kpiPayload);

    // Send to both agents in parallel
    const agentPromises = Object.entries(AGENT_CONFIG).map(async ([agentKey, agentConfig]) => {
      if (!agentConfig.receives_kpis) return;

      try {
        const response = await fetch(`${agentConfig.url}/receive_kpis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(kpiPayload)
        });

        if (response.ok) {
          console.log(`✅ ${agentConfig.name}: KPIs sent successfully`);
        } else {
          console.error(`❌ ${agentConfig.name}: HTTP ${response.status}`);
        }
      } catch (error) {
        console.error(`❌ ${agentConfig.name}: ${error.message}`);
      }
    });

    // Wait for all agents to receive KPIs
    await Promise.all(agentPromises);

    // Update emergency tracking
    if (isEmergency) {
      setLastEmergencyKpiSend(Date.now());
    }

  } catch (error) {
    console.error('Failed to send KPIs to agents:', error);
  }
};

// Function to receive actions from your agent
const receiveAgentAction = async () => {
  if (!agentMode || !metrics) return;
  
  // Only get actions from Agent Two (the controller)
  const controllerAgent = AGENT_CONFIG.agent_two;
  
  if (!controllerAgent.sends_actions) {
    console.log('⚠️ No controller agent configured to send actions');
    return;
  }
  
  try {
    console.log(`🎮 Requesting action from ${controllerAgent.name}...`);
    
    // Prepare current state data for agent decision-making
    const currentState = {
      timestamp: currentTime,
      current_bs_status: bsStatus,
      total_ues: getCurrentUEs().length,
      
      // Send current performance metrics
      system_performance: {
        outage: metrics.systemMetrics.System_Outage,
        qos_satisfaction: metrics.systemMetrics.QoS_Satisfaction,
        total_throughput_mbps: metrics.systemMetrics.Total_Throughput_Mbps,
        total_power_watts: metrics.systemMetrics.Total_Energy_Watts,
        energy_efficiency: metrics.systemMetrics.Energy_Efficiency_Mbps_per_W
      },
      
      // Send current per-BS state to help agent decide
      bs_state: metrics.ruMetrics.map(ru => ({
        bs_id: ru.RU_ID,
        is_on: ru.Power_State === "ON",
        load_percentage: parseFloat((ru.Load * 100).toFixed(1)),
        connected_ues: ru.Connected_UEs,
        throughput_mbps: parseFloat(ru.Throughput_Mbps.toFixed(2)),
        power_watts: parseFloat(ru.Power_Watts.toFixed(1)),
        prb_used: Math.round(ru.Total_PRBs * ru.Load),
        prb_total: ru.Total_PRBs
      })),
      
      // Indicate if this is during emergency conditions
      emergency_state: emergencyTriggered
    };
    
    // Request new action from Agent Two only
    const response = await fetch(`${controllerAgent.url}/get_action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentState)
    });
    
    if (!response.ok) {
      console.error(`❌ ${controllerAgent.name}: HTTP ${response.status}`);
      return;
    }
    
    const data = await response.json();
    
    // Handle agent response - expecting {"bs_actions": [true, false, true, false, true, true]}
    if (data.bs_actions && Array.isArray(data.bs_actions) && data.bs_actions.length === 6) {
      console.log(`✅ ${controllerAgent.name} decision:`, data.bs_actions);
      
      // Check what changed
      const changes = bsStatus.map((current, i) => {
        if (current !== data.bs_actions[i]) {
          return `BS_${i+1}: ${current ? 'ON→OFF' : 'OFF→ON'}`;
        }
        return null;
      }).filter(Boolean);
      
      if (changes.length > 0) {
        console.log(`🔄 ${controllerAgent.name} changes:`, changes);
        
        // Show emergency context if applicable
        if (emergencyTriggered) {
          console.log('⚡ Action taken during emergency conditions');
        }
      } else {
        console.log(`📋 ${controllerAgent.name}: No changes needed`);
      }
      
      setBsStatus(data.bs_actions); // This will automatically update the network!
    } else {
      console.error(`❌ Invalid response from ${controllerAgent.name}. Expected: {"bs_actions": [true, false, ...]}`);
      console.log('Received:', data);
    }
    
  } catch (error) {
    console.error(`❌ ${controllerAgent.name} communication error:`, error);
  }
};

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
  if (isRunning) {
    clearInterval(intervalRef.current);
    const intervalTime = 1000 / simulationSpeed;
    intervalRef.current = setInterval(() => {
      setCurrentTime(prevTime => {
        const times = [...new Set(mobilityData.map(d => d.time))].sort((a, b) => a - b);
        const currentIndex = times.indexOf(prevTime);
        const nextIndex = (currentIndex + 1) % times.length;
        return times[nextIndex];
        });
     }, intervalTime);
         }
    }, [simulationSpeed, isRunning]);

  // ADD this new useEffect after all your existing useEffect hooks (around line 470-480)

// Agent polling loop - requests actions from agent every 10 seconds
useEffect(() => {
  let agentInterval;
  
  if (agentMode && isRunning) {
    console.log('🤖 Starting agent communication...');
    
    // Get initial action from agent immediately
    setTimeout(receiveAgentAction, 1000);
    
    // Then poll agent every 10 seconds for new actions
    agentInterval = setInterval(receiveAgentAction, 10000);
  } else if (!agentMode) {
    console.log('📱 Agent mode disabled - manual control');
  }
  
  return () => {
    if (agentInterval) {
      clearInterval(agentInterval);
      console.log('🛑 Stopped agent communication');
    }
  };
}, [agentMode, isRunning]);



  const currentUEs = getCurrentUEs();

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Radio className="h-8 w-8 text-blue-400" />
            5G Network Dashboard - Leeds City Centre
          </h1>
          <div className="flex items-center gap-4">

<div className="flex items-center gap-4">
  <div className="flex items-center gap-2">
    <span className="text-sm text-gray-300">Multi-Agent System:</span>
    <button
      onClick={() => {
        const newAgentMode = !agentMode;
        setAgentMode(newAgentMode);
        
        // When turning OFF agent mode, reset all RUs to ON
        if (!newAgentMode) {
          console.log('🔄 Multi-agent mode disabled - resetting all RUs to ON');
          setBsStatus([true, true, true, true, true, true]);
          setEmergencyTriggered(false);
        }
      }}
      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
        agentMode
          ? 'bg-green-600 hover:bg-green-700 text-white'
          : 'bg-gray-600 hover:bg-gray-700 text-gray-200'
      }`}
    >
      {agentMode ? '🤖 AGENTS ON' : '📱 MANUAL'}
    </button>
  </div>

  {agentMode && (
    <div className="flex items-center gap-3 text-xs">
         
      {/* Emergency Indicator */}
      {emergencyTriggered && (
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
          <span className="text-red-400 font-medium">EMERGENCY</span>
        </div>
      )}
      
      
    </div>
  )}
</div>
            <div className="text-sm text-gray-400">
            Time: {(() => {
    const totalSeconds = currentTime;
    const days = Math.floor(totalSeconds / 86400); // 86400 seconds in a day
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayName = dayNames[days % 7];
    
    return `${dayName} ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  })()} | Total UEs: {currentUEs.length} |
</div>
          </div>
        </div>
      </div>

      <div className="flex">
        <div className="w-80 bg-gray-800 border-r border-gray-700 p-6 space-y-6">
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-200">Mobility Data</h3>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              ref={fileInputRef}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <Upload className="h-4 w-4" />
              Upload CSV
            </button>
            {mobilityData.length > 0 && (
              <div className="text-sm text-gray-400">
                Loaded: {mobilityData.length} records
                <br />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-200">Simulation</h3>
            <div className="flex gap-2">
              <button
                onClick={toggleSimulation}
                disabled={mobilityData.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isRunning ? 'Pause' : 'Start'}
              </button>
              <button
                onClick={resetSimulation}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">Speed:</span>
                <span className="text-sm text-blue-400 font-medium">{simulationSpeed.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="50"
                step="1"
                value={simulationSpeed}
                onChange={(e) => setSimulationSpeed(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>0.5x</span>
                <span>50x</span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
              Base Stations
              {agentMode && <span className="text-xs bg-green-600 px-2 py-1 rounded">AI Controlled</span>}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {bsStatus.map((isOn, index) => (
                <button
                  key={index}
                  onClick={() => toggleBS(index)}
                  disabled={agentMode}
                  className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium ${
                    isOn
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'bg-red-600 hover:bg-red-700 text-white'
                  } ${agentMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isOn ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
                  BS {index + 1}
                </button>
              ))}
            </div>
          </div>

          {metrics && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-gray-200">System KPIs</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Network Throughput:</span>
                  <span className="text-blue-400 font-medium">{metrics.systemMetrics.Total_Throughput_Mbps.toFixed(1)} Mbps</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Cons. Power:</span>
                  <span className="text-red-400 font-medium">{metrics.systemMetrics.Total_Energy_Watts.toFixed(1)}W</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">System Outage:</span>
                  <span className="text-red-400 font-medium">{(metrics.systemMetrics.System_Outage * 100).toFixed(2)} %</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">QoS Satisfaction:</span>
                  <span className="text-green-400 font-medium">{(metrics.systemMetrics.QoS_Satisfaction * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Thr/Pwr Efficiency:</span>
                  <span className="text-purple-400 font-medium">{metrics.systemMetrics.Energy_Efficiency_Mbps_per_W.toFixed(3)} Mbps/W</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Active BSs:</span>
                  <span className="text-yellow-400 font-medium">{metrics.systemMetrics.Active_RUs}/{metrics.systemMetrics.Total_RUs}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Total UEs:</span>
                  <span className="text-yellow-400 font-medium">{currentUEs.length}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 p-6">
          <div className="bg-gray-800 rounded-lg p-6 h-full">
            <h2 className="text-xl font-semibold mb-4 text-gray-200">Network Topology - Leeds City Centre</h2>

            <div
              ref={mapRef}
              className="w-full rounded-lg border border-gray-700 overflow-hidden"
              style={{ height: '500px' }}
            >
              {!mapReady && (
                <div className="w-full h-full flex items-center justify-center bg-gray-700">
                  <div className="text-center">
                    <div className="animate-pulse text-gray-400 mb-2">Loading Leeds Map...</div>
                    <div className="text-xs text-gray-500">Initializing Leaflet mapping service</div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 text-sm text-gray-400">
              📍 Interactive Leeds city map
              <br />
              🔬 UMi path loss, SNR/Shannon capacity, PRB allocation
              <br />
              ⚡ Non-linear energy scaling, outage detection, real KPIs
              <br />
              🎮 Speed: {simulationSpeed}x | Metrics update every 30s
            </div>

            {metrics?.ueMetrics && metrics.ueMetrics.length > 0 && (
              <div className="mt-4 bg-gray-700 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-200 mb-2">Real-time UE Performance</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                  {metrics.ueMetrics.slice(0, 6).map((ue, index) => (
                    <div key={index} className="bg-gray-800 rounded p-2">
                      <div className="font-medium text-yellow-400">UE {ue.UE_ID}</div>
                      <div className="text-gray-300">
                        Serving: BS{ue.Serving_RU + 1} | SNR: {ue.SNR_dB.toFixed(1)}dB
                        <br />
                        Rate: {ue.Rate_Mbps.toFixed(1)}Mbps | PRBs: {ue.PRBs_Allocated}
                        <br />
                        {ue.Outage ? <span className="text-red-400">OUTAGE</span> : <span className="text-green-400">OK</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="w-80 bg-gray-800 border-l border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-200 mb-4">RU Status</h3>
          <div className="space-y-3">
            {metrics?.ruMetrics.map((ru, index) => (
              <div key={index} className="bg-gray-900 rounded-lg p-3 border border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-200">RU {ru.RU_ID + 1}</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    ru.Power_State === 'ON'
                      ? 'bg-green-600 text-white'
                      : 'bg-red-600 text-white'
                  }`}>
                    {ru.Power_State}
                  </span>
                </div>
                {ru.Power_State === 'ON' && (
                  <div className="space-y-1 text-sm text-gray-400">
                    <div className="flex justify-between">
                      <span>Load:</span>
                      <span className="text-blue-400">{(ru.Load * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Throughput:</span>
                      <span className="text-green-400">{ru.Throughput_Mbps.toFixed(1)} Mbps</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Power:</span>
                      <span className="text-red-400">{ru.Power_Watts.toFixed(1)} W</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Connected UEs:</span>
                      <span className="text-yellow-400">{ru.Connected_UEs}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <h4 className="text-sm font-semibold text-gray-200 mb-3">Demo Data</h4>
            <button
              onClick={() => {
                const sampleData = [];
                for (let time = 0; time <= 60; time += 3) {
                  const numUEs = Math.floor(Math.random() * 10) + 5;
                  for (let ue = 1; ue <= numUEs; ue++) {
                    sampleData.push({
                      time: time,
                      ue_id: ue,
                      x: (Math.random() - 0.5) * 600,
                      y: (Math.random() - 0.5) * 600,
                      z: 1.5
                    });
                  }
                }
                setMobilityData(sampleData);
                setMaxTime(60);
                setCurrentTime(0);
                console.log('Generated sample data');
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors text-sm"
            >
              Generate Sample Data
            </button>
            <div className="text-xs text-gray-500 mt-2">
              Creates random UE mobility for testing
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NetworkDashboard;