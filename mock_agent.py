#!/usr/bin/env python3
"""
Mock Agent Server for Testing 5G Dashboard
Save as: mock_agent.py
Run with: python mock_agent.py
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import random
import time

app = Flask(__name__)
CORS(app)  # Enable CORS for browser requests

# Store received KPIs for logging
received_kpis = []

@app.route('/receive_kpis', methods=['POST'])
def receive_kpis():
    """Receive KPIs from dashboard"""
    try:
        data = request.get_json()
        timestamp = data.get('timestamp', 'unknown')
        bs_data = data.get('bs_data', [])
        total_ues = data.get('total_ues', 0)
        
        print(f"\n📊 RECEIVED KPIs at time {timestamp}:")
        print(f"   Total UEs: {total_ues}")
        
        for bs in bs_data:
            print(f"   {bs['Cell_name']}: {bs['UEThobDL']:.1f} Mbps, "
                  f"{bs['connected_UEs']} UEs, "
                  f"{bs['PRBUSED_DL']}/{bs['PRBTOTAL']} PRBs, "
                  f"Power: {bs['Power_State']}")
        
        # Store for potential analysis
        received_kpis.append(data)
        
        return jsonify({"status": "received", "timestamp": timestamp}), 200
        
    except Exception as e:
        print(f"❌ Error receiving KPIs: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/get_action', methods=['POST'])
def get_action():
    """Provide actions to dashboard"""
    try:
        data = request.get_json()
        current_status = data.get('current_bs_status', [True] * 6)
        timestamp = data.get('timestamp', 'unknown')
        bs_state = data.get('bs_state', [])
        
        print(f"\n🤖 ACTION REQUEST at time {timestamp}:")
        print(f"   Current BS status: {current_status}")
        
        # STRATEGY 1: Random changes (for testing)
        if random.random() < 0.3:  # 30% chance to make changes
            new_actions = current_status.copy()
            # Randomly flip 1-2 BS states
            for _ in range(random.randint(1, 2)):
                bs_index = random.randint(0, 5)
                new_actions[bs_index] = not new_actions[bs_index]
            print(f"   🎲 Random strategy: {new_actions}")
        
        # STRATEGY 2: Energy saving (turn off low-load BS)
        elif len(bs_state) == 6:
            new_actions = [True] * 6  # Start with all ON
            for i, bs in enumerate(bs_state):
                # Turn off BS if load < 20% and at least 4 BS will remain on
                if bs['load_percentage'] < 20 and sum(new_actions) > 4:
                    new_actions[i] = False
            print(f"   💡 Energy saving strategy: {new_actions}")
        
        # STRATEGY 3: Keep current state (no changes)
        else:
            new_actions = current_status.copy()
            print(f"   ⏸️  No change strategy: {new_actions}")
        
        # Show what's changing
        changes = []
        for i, (old, new) in enumerate(zip(current_status, new_actions)):
            if old != new:
                changes.append(f"BS_{i+1}: {'ON' if old else 'OFF'} → {'ON' if new else 'OFF'}")
        
        if changes:
            print(f"   📝 Changes: {', '.join(changes)}")
        else:
            print(f"   📝 No changes made")
        
        return jsonify({"bs_actions": new_actions}), 200
        
    except Exception as e:
        print(f"❌ Error generating action: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/status', methods=['GET'])
def status():
    """Health check endpoint"""
    return jsonify({
        "status": "running",
        "kpis_received": len(received_kpis),
        "last_kpi_time": received_kpis[-1].get('timestamp') if received_kpis else None
    }), 200

if __name__ == '__main__':
    print("🚀 Starting Mock Agent Server...")
    print("📡 Endpoints:")
    print("   POST http://localhost:5000/receive_kpis")
    print("   POST http://localhost:5000/get_action") 
    print("   GET  http://localhost:5000/status")
    print("\n🔧 To test with dashboard:")
    print("   Replace 'YOUR_AGENT_ENDPOINT' with 'http://localhost:5000'")
    print("\n📊 Watching for dashboard connections...\n")
    
    app.run(host='0.0.0.0', port=5000, debug=True)