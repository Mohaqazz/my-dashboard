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
    """Receive KPIs from dashboard - serves both Agent One and Agent Two"""
    try:
        data = request.get_json()
        timestamp = data.get('timestamp', 'unknown')
        bs_data = data.get('bs_data', [])
        total_ues = data.get('total_ues', 0)
        trigger_type = data.get('trigger_type', 'unknown')
        system_metrics = data.get('system_metrics', {})
        
        # Determine trigger type display
        trigger_icon = "🚨" if trigger_type == "emergency" else "📊"
        trigger_text = trigger_type.upper()
        
        print(f"\n{trigger_icon} {trigger_text} KPIs RECEIVED at time {timestamp}:")
        print(f"   📱 Total UEs: {total_ues}")
        
        # Show system-level metrics
        if system_metrics:
            outage = system_metrics.get('outage', 0)
            qos = system_metrics.get('qos_satisfaction', 0)
            print(f"   📈 System Outage: {outage*100:.1f}% | QoS: {qos*100:.1f}%")
            print(f"   ⚡ Power: {system_metrics.get('total_power_watts', 0):.1f}W | "
                  f"Throughput: {system_metrics.get('total_throughput_mbps', 0):.1f}Mbps")
        
        print(f"   🏢 BS Status:")
        for bs in bs_data:
            status_icon = "🟢" if bs['Power_State'] == 'ON' else "🔴"
            print(f"      {status_icon} {bs['Cell_name']}: {bs['UEThobDL']:.1f}Mbps, "
                  f"{bs['connected_UEs']}UEs, {bs['PRBUSED_DL']}/{bs['PRBTOTAL']}PRBs, "
                  f"{bs['Load_Percentage']:.1f}% load")
        
        # Store for potential analysis
        received_kpis.append(data)
        
        # Simulate both agents receiving (same endpoint, different processing)
        print(f"   🔵 Agent One (Monitor): Data logged for analysis")
        print(f"   🟢 Agent Two (Controller): Data received for decision making")
        
        return jsonify({
            "status": "received", 
            "timestamp": timestamp,
            "agents_notified": ["agent_one", "agent_two"],
            "trigger_type": trigger_type
        }), 200
        
    except Exception as e:
        print(f"❌ Error receiving KPIs: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/get_action', methods=['POST'])
def get_action():
    """Provide actions to dashboard - Only Agent Two (Controller) responds"""
    try:
        data = request.get_json()
        current_status = data.get('current_bs_status', [True] * 6)
        timestamp = data.get('timestamp', 'unknown')
        bs_state = data.get('bs_state', [])
        system_performance = data.get('system_performance', {})
        emergency_state = data.get('emergency_state', False)
        
        emergency_icon = "⚡" if emergency_state else "🎮"
        emergency_text = " [EMERGENCY RESPONSE]" if emergency_state else ""
        
        print(f"\n{emergency_icon} ACTION REQUEST{emergency_text} at time {timestamp}:")
        print(f"   🟢 Agent Two (Controller) processing request...")
        print(f"   📊 Current BS status: {current_status}")
        
        if system_performance:
            outage = system_performance.get('outage', 0)
            qos = system_performance.get('qos_satisfaction', 0)
            efficiency = system_performance.get('energy_efficiency', 0)
            print(f"   📈 Performance: Outage {outage*100:.1f}%, QoS {qos*100:.1f}%, Efficiency {efficiency:.3f}")
        
        # STRATEGY SELECTION based on conditions
        if emergency_state:
            # EMERGENCY STRATEGY: Turn on more BSs to improve coverage
            print(f"   🚨 Emergency strategy: Maximize coverage")
            new_actions = [True] * 6  # Turn all BSs ON during emergency
            print(f"   💡 Emergency decision: Turn ALL BSs ON for maximum coverage")
        
        elif len(bs_state) >= 6:
            # INTELLIGENT STRATEGY: Load balancing with energy efficiency
            new_actions = current_status.copy()
            total_load = sum(bs['load_percentage'] for bs in bs_state if bs['is_on'])
            avg_load = total_load / max(sum(1 for bs in bs_state if bs['is_on']), 1)
            
            print(f"   🧠 Intelligent strategy: Avg load {avg_load:.1f}%")
            
            for i, bs in enumerate(bs_state):
                if bs['is_on']:
                    # Turn off lightly loaded BSs if enough coverage remains
                    if bs['load_percentage'] < 15 and sum(new_actions) > 3:
                        new_actions[i] = False
                        print(f"      💤 BS_{i+1}: Low load ({bs['load_percentage']:.1f}%) → OFF")
                else:
                    # Turn on BSs if system is overloaded
                    if avg_load > 70:
                        new_actions[i] = True
                        print(f"      🔋 BS_{i+1}: High system load → ON")
            
        elif random.random() < 0.25:  
            # RANDOM STRATEGY: 25% chance for testing
            new_actions = current_status.copy()
            for _ in range(random.randint(1, 2)):
                bs_index = random.randint(0, 5)
                new_actions[bs_index] = not new_actions[bs_index]
            print(f"   🎲 Random strategy for testing")
        
        else:
            # NO CHANGE STRATEGY: Keep current state
            new_actions = current_status.copy()
            print(f"   ⏸️  No change strategy: Current state optimal")
        
        # Show what's changing
        changes = []
        for i, (old, new) in enumerate(zip(current_status, new_actions)):
            if old != new:
                changes.append(f"BS_{i+1}: {'ON' if old else 'OFF'} → {'ON' if new else 'OFF'}")
        
        if changes:
            print(f"   🔄 Agent Two changes: {', '.join(changes)}")
        else:
            print(f"   📋 Agent Two: No changes needed")
        
        print(f"   ✅ Agent Two decision: {new_actions}")
        
        return jsonify({
            "bs_actions": new_actions,
            "strategy_used": "emergency" if emergency_state else "intelligent",
            "agent": "agent_two_controller"
        }), 200
        
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
    print("🚀 Starting Enhanced Dual-Agent Mock Server...")
    print("📡 Endpoints:")
    print("   POST http://localhost:5000/receive_kpis (Both agents)")
    print("   POST http://localhost:5000/get_action (Agent Two only)") 
    print("   GET  http://localhost:5000/status")
    print("\n🤖 Agent Simulation:")
    print("   🔵 Agent One (Monitor): Receives and logs KPIs")
    print("   🟢 Agent Two (Controller): Receives KPIs + sends actions")
    print("\n🔧 To test with dashboard:")
    print("   Use 'http://localhost:5000' for both agent URLs")
    print("   Emergency triggers when System_Outage > 95%")
    print("\n📊 Watching for dual-agent connections...\n")
    
    app.run(host='0.0.0.0', port=5000, debug=True)