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
        public void Execute(Configuration config, QueueItem item)
        {
            services.OutputLoggerService.Log("Begin Workflow: Process");
            Config = config;
            TimeSpanBetweenActions = 2 + Config.Applications.Count + Config.DataSources.Count;
            PercentChanceOfFailure =  .001;
            
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
            }
            catch(BusinessRuleException businessException) {
                throw;
            }   
            catch(Exception systemException) {
                throw;
            }
            
            
            var additionalLogFields = new Dictionary<string, object>();
            additionalLogFields.Add(logfProcessingRecordId, item.Reference);
            additionalLogFields.Add(logfProcessingRecordStatus, "SUCCESSFUL");
            services.OutputLoggerService.Log(String.Format("Successfully processed record with id '{0}'.", item.Reference.ToString()), LogLevel.Trace, additionalLogFields);
            
 
            var loggableAdditionalFields = new Dictionary<string, object>();
            
            try{
                loggableAdditionalFields.Add("LOGGING_InsightsDataMapping", Config.InsightsDataMapping);
                loggableAdditionalFields.Add("LOGGING_SpecificContent_QueueItemContent", item.SpecificContent);
                var loggable = new LoggableInsightsData(Config, item);

                services.OutputLoggerService.Log("Calling LogInsightsData workflow.", LogLevel.Trace, loggableAdditionalFields);
                workflows.LogInsightsData(Config, loggable);
                
            }
            catch(NullReferenceException nre) {
                services.OutputLoggerService.Log(String.Format("Missing required objects to build a LoggableDataItem: {0}", nre.Message), LogLevel.Fatal, loggableAdditionalFields);
                throw;
            }
            catch(Exception e) {
                services.OutputLoggerService.Log(String.Format("Could not build a Loggable data item: {0}", e.Message), LogLevel.Fatal, loggableAdditionalFields);
                throw;
            }
            
            services.OutputLoggerService.Log("End Workflow: Process");
        }
        
        private Double PercentChanceOfFailure { get; set; }
        private Int32 TimeSpanBetweenActions { get; set; }
        private Configuration Config { get; set;}

        
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
            var result = false;
            if(Random.Shared.NextDouble() < PercentChanceOfFailure)
                result  = true;
            
            return result ;
        }
    }
}