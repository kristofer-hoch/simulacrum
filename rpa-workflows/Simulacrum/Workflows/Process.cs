using System;
using System.Collections.Generic;
using System.Threading;
using UiPath.CodedWorkflows;
using UiPath.Core;
using Simulacrum.Models;
using Simulacrum.Common;

namespace Simulacrum.Workflows
{
    public class Process : CodedWorkflow
    {
        private const String logfProcessingRecordId = "PROCESS_RECORD_ID";
        private const String logfProcessingRecordStatus = "PROCESS_RECORD_STATUS";
        private const String logfProcessingRecordMessage = "PROCESS_RECORD_MESSAGE";
        
        [Workflow]
        public ProcessExecutionResults Execute(Configuration config, QueueItem item)
        {
            services.OutputLoggerService.Log("Begin Workflow: Process");
            Config = config;
            var executionResults = new ProcessExecutionResults(item);
            
            // Generating a chance of failure based on the number of applications and data sources, plus 2.
            TimeSpanBetweenActions = 2 + Config.Applications.Count + Config.DataSources.Count;
            PercentChanceOfFailure =  .01;
            
            try {
                foreach(var application in Config.Applications) {
                    var message = String.Format("Accessing in {0}", application);
                    services.OutputLoggerService.Log(message, LogLevel.Trace, Config.StandardLogFields);
                    
                    CheckForRandomSystemException(application);
                    Delay();
                }
                
                foreach(var dataSource in Config.DataSources) {
                    var message = String.Format("Verifying information in {0}", dataSource);
                    services.OutputLoggerService.Log(message, LogLevel.Trace, Config.StandardLogFields);
                    
                    CheckForRandomBuisnessException(dataSource);
                    Delay();
                }
                
                executionResults.TransactionItem.Status = QueueItemStatus.Successful;
            }
            catch(BusinessRuleException businessException) {
                executionResults.TransactionItem.Status = QueueItemStatus.Failed;
                executionResults.BusinessException = businessException;
                executionResults.Details = businessException.StackTrace;
                executionResults.Reason = businessException.Message;
                executionResults.TransactionErrorType = UiPath.Core.Activities.ErrorType.Business;
            }   
            catch(Exception systemException) {
                executionResults.TransactionItem.Status = QueueItemStatus.Failed;
                executionResults.SystemException = systemException;
                executionResults.Details = systemException.StackTrace;
                executionResults.Reason = systemException.Message;
                executionResults.TransactionErrorType = UiPath.Core.Activities.ErrorType.Application;
            }
            
            LogResults(executionResults);
            
            services.OutputLoggerService.Log("End Workflow: Process");
            return executionResults;
        }
        
        private Double PercentChanceOfFailure { get; set; }
        private Int32 TimeSpanBetweenActions { get; set; }
        private Configuration Config { get; set;}

        
        /// <summary>
        /// 
        /// </summary>
        /// <param name="results"></param>
        private void LogResults(ProcessExecutionResults results) {
            var additionalLogFields = new Dictionary<string, object>();
            additionalLogFields.Add(logfProcessingRecordId, Guid.NewGuid().ToString());
            additionalLogFields.Add(logfProcessingRecordStatus, "SUCCESSFUL");
            additionalLogFields.Add(logfProcessingRecordMessage, "Successfully processed the record.");
            
            if(null != results.BusinessException) {
                additionalLogFields[logfProcessingRecordStatus] = "FAILURE";
                additionalLogFields[logfProcessingRecordMessage] = results.BusinessException.Message;
            }
            
            if(null != results.SystemException) {
                additionalLogFields[logfProcessingRecordStatus] = "FAILURE";
                additionalLogFields[logfProcessingRecordMessage] = results.SystemException.Message;
            }
            
            var logFields = UtilityHelpers.GetAdditionalLogFields(Config, additionalLogFields);
            if(results.TransactionItem.Status == QueueItemStatus.Successful) {
                services.OutputLoggerService.Log("Successfully processed the record", LogLevel.Info, logFields);
                var loggable = new LoggableInsightsData(Config, results.TransactionItem);
                workflows.LogInsightsData(Config, loggable);
            }
            else {
                services.OutputLoggerService.Log("Failures encountered when processing the data record", LogLevel.Warn, logFields);
            }
        }
        
        private void Delay() {
            var sleepTime = Random.Shared.Next(250, 1000) * TimeSpanBetweenActions;
            Thread.Sleep(sleepTime);
        }
        

        // TRIGGER FAILURES
        private void CheckForRandomSystemException(string applicationName) {
            if(!CheckForRandomException())
                return;
            
            throw new Exception(string.Format("A system exception was generated when using the {0} application", applicationName));
        }
        
        private void CheckForRandomBuisnessException(string dataSource) {
            if(!CheckForRandomException())
                return;
            
            throw new BusinessRuleException(string.Format("A business rule exception was generated when saving data to {0}", dataSource));
        }

        private bool CheckForRandomException() {
            if(Random.Shared.NextDouble() < PercentChanceOfFailure)
                return true;
            
            return false;
        }
    }
}