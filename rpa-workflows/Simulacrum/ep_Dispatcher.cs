using System;
using System.Collections.Generic;
using UiPath.CodedWorkflows;
using UiPath.Core;
using Simulacrum.Common;
using Simulacrum.Models;

namespace Simulacrum
{
    public class ep_Dispatcher : CodedWorkflow
    {
        [Workflow]
        public void Execute()
        {
            services.OutputLoggerService.Log("Starting the process");
            
            try {
                try {
                    services.OutputLoggerService.Log("Getting the process configuration");
                    Config = workflows.GetConfiguration(false);
                    StandardLogFields = UtilityHelpers.GetAdditionalLogFields(Config);
                }
                catch(Exception e) {
                    var message = string.Format("Could not get configuration at the start of the process: {0}", e.Message);
                    services.OutputLoggerService.Log(message, LogLevel.Fatal, null);
                    throw;
                }
                
                services.OutputLoggerService.Log("Downloading data from the Agent", LogLevel.Trace, StandardLogFields);
                var agentData = workflows.GetAgentData(Config);
                
                services.OutputLoggerService.Log("Creating queue items from the Agent data ", LogLevel.Trace, StandardLogFields);
                foreach(var specificContent in agentData.InputData) {
                    var reference = Guid.NewGuid().ToString();
                    
                    services.OutputLoggerService.Log(string.Format("Adding queue item with Reference: {0}", reference), LogLevel.Trace, StandardLogFields);
                    system.AddQueueItem(
                        Config.QueueName, 
                        string.Empty, 
                        DateTime.Now.AddDays(2), 
                        specificContent, 
                        DateTime.Now.AddSeconds(-1), 
                        QueueItemPriority.Normal, 
                        reference, 
                        10000);
                }
                services.OutputLoggerService.Log("Process completed");                
            }
            catch (Exception e) {
                services.OutputLoggerService.Log(string.Format("Exception: {0}", e.Message));
                workflows.GlobalException(e);
                throw;
            }
        }
        
        private Configuration Config { get; set; }
        
        private Dictionary<string, object> StandardLogFields { get; set; }
    }
}