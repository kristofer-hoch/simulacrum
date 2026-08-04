using System;
using System.Collections.Generic;
using System.Data;
using UiPath.Activities.System.Jobs.Coded;
using UiPath.CodedWorkflows;
using UiPath.Core;
using UiPath.Core.Activities;
using Simulacrum.Models;

namespace Simulacrum.Workflows
{

    public class GetAgentData : CodedWorkflow
    {
        [Workflow]
        public AgentData Execute(Configuration config)
        {
            services.OutputLoggerService.Log("Starting Workflow: GetAgentData");
           
            AgentData agentData;
            OrchestratorJob jobData;
            string outputJson;            

            var additionalLogFields = config.StandardLogFields;
            additionalLogFields.Add("DataAgentProcessName",config.DataAgentProcessName);
            additionalLogFields.Add("DataAgentOrchestratorFolder", config.DataAgentOrchestratorFolder);

            // First Invoke the Agent
            try{
                var input = new Dictionary<string, object>();
                input.Add("dataInformationJson", config.RawJsonString);
                (jobData, outputJson) = system.RunJob(config.DataAgentProcessName, config.DataAgentOrchestratorFolder, input, false, null);
                
            } 
            catch(Exception e) {
                var message = string.Format("Failed to successfully execute {0} in folder {1}", config.DataAgentProcessName, config.DataAgentOrchestratorFolder);
                additionalLogFields.Add("ExceptionMessage", e.Message);
                services.OutputLoggerService.Log(message, UiPath.CodedWorkflows.LogLevel.Fatal, additionalLogFields);
                
                throw;
            }
            
            try {
                agentData = new AgentData(outputJson);
            }
            catch(Exception e) 
            {
                var message = string.Format("Could not parse the output from the {0}", config.DataAgentProcessName);
                services.OutputLoggerService.Log(message, UiPath.CodedWorkflows.LogLevel.Fatal, additionalLogFields);        
                throw;                
            }
            
            services.OutputLoggerService.Log("Finished Workflow: GetAgentData");
            return agentData;
        }    
    }
}