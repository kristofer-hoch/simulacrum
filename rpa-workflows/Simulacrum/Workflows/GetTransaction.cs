using System;
using UiPath.CodedWorkflows;
using UiPath.Core;
using Simulacrum.Models;

namespace Simulacrum.Workflows
{
    public class GetTransaction : CodedWorkflow
    {
        [Workflow]
        public QueueItem Execute(Configuration config)
        {
            QueueItem item = null;
            var shouldStop = workflows.ShouldStop();
            if(shouldStop) {
                services.OutputLoggerService.Log("Recieved stop request from Orchestator.", LogLevel.Warn, config.StandardLogFields);
                return null;
            }
            
            try {
                item = system.GetTransactionItem(config.QueueName);
            }
            catch(Exception e) {
                var message = String.Format("Could not get a transaction item from the {0} (queue)", config.QueueName);
                var additionalLogFields = config.StandardLogFields;
                additionalLogFields.Add("ExceptionMessage", e.Message);
                
                services.OutputLoggerService.Log(message, LogLevel.Fatal, additionalLogFields);
                
                throw;
            }
            
            return item;
        }
    }
}