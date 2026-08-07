using System;
using System.Collections.Generic;
using UiPath.CodedWorkflows;
using UiPath.Core;

using Simulacrum.Models;

namespace Simulacrum
{
    public class ep_Performer : CodedWorkflow
    {        
        [Workflow]
        public void Execute()
        {                
            services.OutputLoggerService.Log("Starting the process");
            
            try {
                
                try {
                    services.OutputLoggerService.Log("Getting the process configuration");
                    Config = workflows.GetConfiguration(false);
                }
                catch(Exception e) {
                    var message = string.Format("Could not get configuration at the start of the process: {0}", e.Message);
                    services.OutputLoggerService.Log(message, LogLevel.Fatal, null);
                    throw;
                }
                
                // Perform while we're going transactions
                while(1 == 1) {
                    var transactionItem = workflows.GetTransaction(Config);
                    if(null == transactionItem)
                        break;
                    
                    try {
                        var updatedTransactionItem = workflows.Process(Config, transactionItem);
                        system.SetTransactionStatus(updatedTransactionItem, ProcessingStatus.Successful, String.Empty, new Dictionary<string, object>(), updatedTransactionItem.Output, "Adding data to output", UiPath.Core.Activities.ErrorType.Application, string.Empty, 30000);
                    }
                    catch(BusinessRuleException bre) {
                        SetTranscationFailureStatus(bre, UiPath.Core.Activities.ErrorType.Business, transactionItem);
                    }
                    catch(Exception e){
                        SetTranscationFailureStatus(e, UiPath.Core.Activities.ErrorType.Application, transactionItem);
                        throw;
                    }
                }
                
                services.OutputLoggerService.Log("Process completed");                
            }
            catch (Exception e) {
                services.OutputLoggerService.Log(string.Format("Exception: {0}", e.Message));
                workflows.GlobalException(e);
                
                throw;
            }
        }
        
        private void SetTranscationFailureStatus(Exception exception, UiPath.Core.Activities.ErrorType errorType, QueueItem transactionItem) {
            system.SetTransactionStatus(
                transactionItem, 
                ProcessingStatus.Failed, 
                string.Empty,
                transactionItem.SpecificContent,
                null,
                exception.Message,
                errorType,
                "The process encountered an exception",
                10000);
        }
        
        private Configuration Config { get; set; }
        
        private Dictionary<string, object> StandardLogFields { get; set; }
    }
}