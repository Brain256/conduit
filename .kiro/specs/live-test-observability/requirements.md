# Requirements Document

## Introduction

The Live_Test_Observability feature extends the Dashboard and Load_Tester with live metric visualization, the most recent request-response packet and Ping_Time, a completed-test Final_Summary, a Test_Event timeline, and README-ready exports of a completed Test's latency graph and source data. The feature preserves the existing test start and WebSocket Metric_Stream lifecycle.

## Glossary

- **Dashboard**: The browser application that starts a Test and presents Test data.
- **Load_Tester**: The Go service that executes HTTP request attempts and streams Metric_Frames for a Test.
- **Operator**: A person using the Dashboard to observe or review a Test.
- **Test**: One load-test execution identified by a Test_ID and configured with a duration, target request rate, target port, and worker count.
- **Active_Test**: The Test currently selected by the Dashboard for live observation.
- **Test_ID**: The unique identifier returned when the Dashboard starts a Test.
- **Metric_Stream**: The WebSocket connection that carries Metric_Frames for a Test from the Load_Tester to the Dashboard.
- **Metric_Frame**: One timestamped message sent through the Metric_Stream during or at completion of a Test that identifies the Test and contains elapsed Test time and Aggregate_Metrics.
- **Completed_Metric_Frame**: The one Metric_Frame that marks a completed Test and contains a Final_Summary.
- **Aggregate_Metric**: A measured latency percentile, request throughput, completed-request count, or failed-request count for a Test.
- **Graph_Datum**: The elapsed Test time and Aggregate_Metric values represented at one point in a live graph.
- **Graph_Data**: The ordered collection of Graph_Datums recorded for one Test.
- **Graph_Position**: An elapsed Test-time position selected by an Operator in a live graph.
- **Ping_Time**: The elapsed time in milliseconds from initiating one HTTP request attempt until receiving its HTTP response or failure.
- **HTTP_Request**: A request attempt sent by the Load_Tester to the configured Test target.
- **HTTP_Response**: The status code and payload returned for a successful HTTP_Request.
- **Request_Payload**: The request method, target URL, request headers, and request body associated with an HTTP_Request.
- **Response_Payload**: The HTTP_Response status code, response headers, and response body associated with an HTTP_Response.
- **Request_Response_Record**: The timestamp, Request_Payload, Response_Payload or failure description, and Ping_Time for one completed HTTP_Request.
- **Packet_View**: The Dashboard view that presents the most recent Request_Response_Record for a Test.
- **Final_Summary**: The Test_ID, configured Test parameters, actual elapsed Test time, total completed requests, total failed requests, achieved throughput, and p50, p95, and p99 Ping_Time values calculated across the entire Test.
- **Final_Summary_Dismissal_Control**: The Dashboard control an Operator uses to dismiss a Final_Summary retained during the Browser_Session.
- **Browser_Session**: The period from opening the Dashboard application in a browser tab until the tab closes or the Operator navigates away from the Dashboard application.
- **Test_Event**: A Test-scoped record containing a timestamp, one of the `test-started`, `request-failed`, or `test-completed` event types, and a non-empty human-readable message.
- **Timeline**: The ordered Dashboard view of Test_Events received for a Test.
- **Pending_Test_Events**: Test_Events received by the Dashboard that have not yet been added to the Timeline.
- **Timeline_Control**: The Dashboard control an Operator uses to display a Timeline.
- **Final_Summary_Export_Control**: The Dashboard control an Operator uses to export a displayed Final_Summary and its associated latency graph data.
- **Final_Summary_Export_Snapshot**: The immutable Final_Summary and ordered Graph_Data retained by the Dashboard for one completed Test.
- **README_Ready_Latency_Graph**: A standalone UTF-8 SVG document that can be referenced by a README without JavaScript, network requests, or external asset files.
- **Latency_Export_Data**: A UTF-8 JSON document containing the metadata, Final_Summary, and Graph_Data represented by a README_Ready_Latency_Graph.

## Requirements

### Requirement 1: Usable live performance graphs

**User Story:** As an Operator, I want to inspect live latency and throughput trends, so that I can identify performance changes while a Test runs.

#### Acceptance Criteria

1. WHEN the Dashboard receives a Metric_Frame whose Test_ID matches the Active_Test Test_ID, whose timestamp is a UTC RFC 3339 timestamp, whose elapsed Test time is a finite non-negative number of seconds, and whose Aggregate_Metrics contain finite non-negative p50, p95, and p99 Ping_Time values, finite non-negative achieved request throughput, non-negative integer completed-request and failed-request counts, and p50 less than or equal to p95 less than or equal to p99, THE Dashboard SHALL add exactly one Graph_Datum to the Active_Test containing the Metric_Frame elapsed Test time and every Aggregate_Metric in that Metric_Frame.
2. IF the Dashboard receives a Metric_Frame whose Test_ID matches the Active_Test Test_ID and which fails a validity condition in acceptance criterion 1, THEN THE Dashboard SHALL leave the Active_Test Graph_Data and displayed graphs unchanged and display "Invalid metric data received for the active test." within 1 second.
3. IF the Dashboard receives a Metric_Frame whose Test_ID does not match the Active_Test Test_ID, THEN THE Dashboard SHALL leave the Active_Test Graph_Data, displayed graphs, and metric-data status unchanged.
4. WHILE the Active_Test has at least one Graph_Datum, THE Dashboard SHALL display a latency graph with elapsed Test time on its horizontal axis and the p50, p95, and p99 Ping_Time values from every Graph_Datum on its vertical axis.
5. WHILE the Active_Test has at least one Graph_Datum, THE Dashboard SHALL display a throughput graph with elapsed Test time on its horizontal axis and the achieved request throughput from every Graph_Datum on its vertical axis.
6. WHEN an Operator points to a Graph_Datum in either graph, THE Dashboard SHALL display the elapsed Test time and the name and value of every Aggregate_Metric represented by that Graph_Datum.
7. WHEN an Operator points to a position in either graph that has no Graph_Datum, THE Dashboard SHALL display a graph interaction detail indicating that no metric was recorded at the elapsed Test time represented by that position.
8. WHILE the Active_Test has no Graph_Datum, THE Dashboard SHALL display "Waiting for metric data." without waiting for a Metric_Frame.
9. WHILE the Active_Test has at least one Graph_Datum, THE Dashboard SHALL remove "Waiting for metric data." from display.
10. WHEN the Dashboard adds the first Graph_Datum to the Active_Test, THE Dashboard SHALL remove "Waiting for metric data." from display, display the latency graph and throughput graph based on that Graph_Datum, and then update any displayed number of Graph_Datums.

### Requirement 2: Most recent request-response packet

**User Story:** As an Operator, I want to see the most recent request-response packet and Ping_Time, so that I can correlate current metrics with concrete target behavior.

#### Acceptance Criteria

1. WHEN the Load_Tester completes an HTTP_Request by receiving an HTTP response or determining that the HTTP_Request failed, THE Load_Tester SHALL replace the most recent Request_Response_Record for the Test with one Request_Response_Record containing the Request_Payload, the completion timestamp, the Ping_Time, and exactly one of the Response_Payload or a failure description.
2. WHEN the Load_Tester emits a Metric_Frame for a Test for which one or more HTTP_Request completions have timestamps not later than the Metric_Frame timestamp, THE Load_Tester SHALL include exactly one Request_Response_Record whose completion timestamp is the latest such completion timestamp, regardless of the elapsed time between that completion timestamp and the Metric_Frame timestamp.
3. WHEN the Load_Tester emits a Metric_Frame for a Test for which no HTTP_Request completion has a timestamp not later than the Metric_Frame timestamp, THE Load_Tester SHALL emit the Metric_Frame without a Request_Response_Record.
4. WHEN the Dashboard receives a Metric_Frame for the Active_Test containing a Request_Response_Record, THE Dashboard SHALL display in the Packet_View the Request_Payload, completion timestamp, Ping_Time, and exactly one of the Response_Payload or failure description from that Request_Response_Record and remove "No completed request-response packet received." after displaying the Request_Response_Record values.
5. IF the Dashboard receives a Metric_Frame for the Active_Test without a Request_Response_Record and the Packet_View displays a Request_Response_Record, THEN THE Dashboard SHALL retain every displayed value of that Request_Response_Record and remove "No completed request-response packet received." from display.
6. IF the Dashboard receives a Metric_Frame for the Active_Test without a Request_Response_Record and the Packet_View does not display a Request_Response_Record, THEN THE Dashboard SHALL display "No completed request-response packet received." within 1 second of receiving the Metric_Frame.

### Requirement 3: Completed-test final summary

**User Story:** As an Operator, I want a final summary after a Test completes, so that I can review the Test outcome without reconstructing the results from live updates.

#### Acceptance Criteria

1. WHEN the Load_Tester completes a Test, THE Load_Tester SHALL emit exactly one Completed_Metric_Frame for that Test containing a Final_Summary whose Test_ID equals that Test's Test_ID, whose actual elapsed Test time is a positive finite number of seconds, and whose configured Test parameters, total completed requests, total failed requests, achieved throughput, and p50, p95, and p99 Ping_Time values are calculated from HTTP_Request attempts made from Test start through Test completion.
2. WHEN the Dashboard receives the first Completed_Metric_Frame whose Test_ID matches the Active_Test Test_ID and whose Final_Summary Test_ID matches the Completed_Metric_Frame Test_ID, THE Dashboard SHALL display exactly one Final_Summary identified by that Test_ID with its configured Test parameters, actual elapsed Test time, total completed requests, total failed requests, achieved throughput, and p50, p95, and p99 Ping_Time values.
3. IF the Dashboard receives a Completed_Metric_Frame whose Test_ID matches the Active_Test Test_ID and whose Final_Summary is absent or has a Test_ID different from the Completed_Metric_Frame Test_ID, THEN THE Dashboard SHALL retain every displayed Final_Summary and display "Invalid final summary received for the active test." within 1 second.
4. IF the Dashboard receives a further Completed_Metric_Frame whose Final_Summary Test_ID matches a displayed Final_Summary Test_ID, THEN THE Dashboard SHALL retain the existing Final_Summary for that Test_ID and display no additional Final_Summary for that Test_ID.
5. WHILE an individually displayed Final_Summary has not been dismissed during the Browser_Session, THE Dashboard SHALL continue to display that Final_Summary after the Metric_Stream closes, the Active_Test changes, or the Operator navigates within the Dashboard application.
6. WHEN an Operator selects the Final_Summary_Dismissal_Control for a Final_Summary retained during the Browser_Session, THE Dashboard SHALL stop retaining only the selected Final_Summary during the Browser_Session and remove that Final_Summary from display if that Final_Summary is displayed.
7. IF the Dashboard cannot process a Final_Summary_Dismissal_Control selection, THEN THE Dashboard SHALL display "Unable to dismiss final summary. Try again.", retain the selected Final_Summary during the Browser_Session, and leave the selected Final_Summary display state unchanged.
8. IF the Metric_Stream for the Active_Test closes before the Dashboard receives a Completed_Metric_Frame containing a Final_Summary whose Test_ID matches the Active_Test Test_ID, THEN THE Dashboard SHALL display "Metric stream ended before a final summary was received." and retain every Final_Summary already displayed.

### Requirement 4: Test log and event timeline

**User Story:** As an Operator, I want to view a Test log and event timeline, so that I can review Test lifecycle and request-failure events.

#### Acceptance Criteria

1. WHEN the Load_Tester starts a Test, THE Load_Tester SHALL create exactly one Test_Event for that Test with the `test-started` event type, a UTC RFC 3339 timestamp representing the Test start time, and a non-empty UTF-8 message.
2. WHEN an HTTP_Request for a Test fails, THE Load_Tester SHALL create exactly one Test_Event for that Test with the `request-failed` event type, a UTC RFC 3339 timestamp representing the failure time, and a non-empty UTF-8 failure-description message.
3. WHEN the Load_Tester completes a Test, THE Load_Tester SHALL create exactly one Test_Event for that Test with the `test-completed` event type, a UTC RFC 3339 timestamp representing the Test completion time, and a non-empty UTF-8 message.
4. WHEN the Load_Tester emits a Metric_Frame for a Test, THE Load_Tester SHALL include each Test_Event for that Test that was created before the Metric_Frame was emitted and was not included in an earlier Metric_Frame for that Test exactly once.
5. IF a Test_Event for a Test has not been included in a Metric_Frame for that Test, THEN THE Load_Tester SHALL retain the Test_Event until it is included exactly once in a later Metric_Frame for that Test.
6. WHEN the Load_Tester emits a Metric_Frame for a Test and zero Test_Events for that Test were created before the Metric_Frame was emitted and not included in an earlier Metric_Frame, THE Load_Tester SHALL emit the Metric_Frame without a Test_Event.
7. WHEN the Dashboard receives one or more Test_Events whose Test_ID matches the Active_Test Test_ID and whose event type and message satisfy acceptance criteria 1 through 3, THE Dashboard SHALL retain exactly one Timeline entry for each first-received Test_Event and ignore each subsequently received duplicate Test_Event without modifying the Active_Test Timeline.
8. WHILE the Active_Test Timeline contains one or more Timeline entries with UTC RFC 3339 timestamps, THE Dashboard SHALL order those entries by ascending timestamp while preserving first-receipt order for entries with identical timestamps.
9. WHEN the Dashboard receives a Test_Event that satisfies acceptance criterion 7 but whose timestamp is not a UTC RFC 3339 timestamp, THE Dashboard SHALL retain the original timestamp in the Timeline entry and place the Timeline entry after every entry with a UTC RFC 3339 timestamp while preserving first-receipt order among entries with non-RFC 3339 timestamps.
10. IF the Dashboard receives a Test_Event whose Test_ID matches the Active_Test Test_ID and whose event type is not `test-started`, `request-failed`, or `test-completed`, or whose message is empty or is not UTF-8 text, THEN THE Dashboard SHALL leave the Active_Test Timeline unchanged and display "Invalid test event received for the active test." within 1 second.
11. IF the Dashboard receives a Test_Event whose Test_ID does not match the Active_Test Test_ID, THEN THE Dashboard SHALL leave the Active_Test Timeline unchanged and display "Invalid test event received for the active test." within 1 second.
12. WHEN an Operator selects the Timeline_Control, THE Dashboard SHALL display the Active_Test Timeline and, for each Test_Event in the Timeline, display its timestamp, event type, and message.
13. WHILE the Active_Test Timeline contains zero Test_Events and the Dashboard has zero Pending_Test_Events for the Active_Test, THE Dashboard SHALL display "No test events received." alongside the Timeline.
14. IF the Active_Test Timeline contains zero Test_Events and the Dashboard has one or more Pending_Test_Events for the Active_Test, THEN THE Dashboard SHALL remove "No test events received." from display.
15. WHILE an Operator has selected the Timeline_Control and the Active_Test Timeline contains zero Test_Events, THE Dashboard SHALL display empty fields labelled timestamp, event type, and message.

### Requirement 5: Export final-summary latency graph and data

**User Story:** As an Operator, I want to export a completed Test's latency graph and source data, so that I can add an accurate performance graph to the README and independently inspect the plotted values.

#### Acceptance Criteria

1. WHEN the Dashboard accepts the first Completed_Metric_Frame for a Test and displays its Final_Summary, THE Dashboard SHALL create exactly one immutable Final_Summary_Export_Snapshot identified by that Final_Summary Test_ID containing that Final_Summary and every Graph_Datum recorded for that Test, including the Graph_Datum from the Completed_Metric_Frame, in ascending elapsed Test-time order while preserving Graph_Datum receipt order for equal elapsed Test times.
2. IF the Dashboard receives a further Completed_Metric_Frame for a Test that already has a Final_Summary_Export_Snapshot, THEN THE Dashboard SHALL retain the existing Final_Summary_Export_Snapshot unchanged.
3. WHILE a displayed Final_Summary has an associated Final_Summary_Export_Snapshot that has not been dismissed during the Browser_Session, THE Dashboard SHALL retain that Final_Summary_Export_Snapshot unchanged after the Metric_Stream closes, the Active_Test changes, or the Operator navigates within the Dashboard application.
4. WHEN an Operator selects the Final_Summary_Export_Control for a displayed Final_Summary with an associated Final_Summary_Export_Snapshot, THE Dashboard SHALL independently initiate exactly one README_Ready_Latency_Graph generation and exactly one Latency_Export_Data generation using that snapshot and shall attempt each generation even if the other generation cannot succeed.
5. WHEN the Dashboard provides a README_Ready_Latency_Graph, THE Dashboard SHALL encode the graph as a standalone UTF-8 SVG document with no JavaScript, network request, or external asset-file dependency.
6. WHEN the Dashboard provides a README_Ready_Latency_Graph, THE Dashboard SHALL include a latency plot with elapsed Test time in seconds on the horizontal axis, Ping_Time in milliseconds on the vertical axis, and one labeled series for the p50, p95, and p99 Ping_Time values from every Graph_Datum in the associated Final_Summary_Export_Snapshot.
7. WHEN the Dashboard provides a README_Ready_Latency_Graph, THE Dashboard SHALL include the Test_ID, configured Test parameters, actual elapsed Test time, total completed requests, total failed requests, achieved throughput, and p50, p95, and p99 Ping_Time values from the associated Final_Summary as visible graph metadata.
8. WHEN the Dashboard provides Latency_Export_Data, THE Dashboard SHALL encode the document as UTF-8 JSON containing the Test_ID, configured Test parameters, every Final_Summary value, and a Graph_Data array ordered exactly as the associated Final_Summary_Export_Snapshot, in which every Graph_Datum includes elapsed Test time, achieved request throughput, completed-request count, failed-request count, and p50, p95, and p99 Ping_Time values.
9. IF an Operator selects the Final_Summary_Export_Control and the selected Final_Summary has no associated Final_Summary_Export_Snapshot, THEN THE Dashboard SHALL display "Unable to export latency graph: completed test data is unavailable.", retain the selected Final_Summary, and initiate neither export generation.
10. WHEN an Operator selects the Final_Summary_Export_Control for a displayed Final_Summary with an associated Final_Summary_Export_Snapshot and the Dashboard detects before generation that the Final_Summary_Export_Snapshot lacks a Final_Summary, Graph_Data, a matching Final_Summary Test_ID, a positive finite actual elapsed Test time, or any value required by acceptance criteria 6 through 8, THE Dashboard SHALL display "Unable to export latency graph: completed test data is invalid.", retain the Final_Summary_Export_Snapshot, and provide neither export document for download.
11. WHEN the Dashboard successfully generates a README_Ready_Latency_Graph, THE Dashboard SHALL provide the document for download with the exact filename `<Test_ID>-latency.svg`, where `<Test_ID>` is the associated Final_Summary Test_ID.
12. WHEN the Dashboard successfully generates Latency_Export_Data, THE Dashboard SHALL provide the document for download with the exact filename `<Test_ID>-latency.json`, where `<Test_ID>` is the associated Final_Summary Test_ID.
13. IF exactly one export generation fails after generation begins, THEN THE Dashboard SHALL retain the associated Final_Summary_Export_Snapshot, provide the successfully generated document for download, and display an error identifying whether the SVG document or JSON document could not be generated.
14. IF neither export generation succeeds after generation begins, THEN THE Dashboard SHALL retain the associated Final_Summary_Export_Snapshot and display "Unable to export latency graph. Try again."
15. WHEN the Dashboard successfully processes a Final_Summary_Dismissal_Control selection for a Final_Summary retained during the Browser_Session, THE Dashboard SHALL remove only the selected Final_Summary's associated Final_Summary_Export_Snapshot from Browser_Session memory, remove that Final_Summary_Export_Control from display if that Final_Summary is displayed, and retain Final_Summary_Export_Snapshots associated with every other retained Final_Summary.

## Assumptions for Review

- Packet_View content includes complete request and response bodies as defined by Request_Payload and Response_Payload. The implementation plan will need an explicit size limit and redaction policy before production use.
- Final_Summary retention applies only within a Browser_Session and during Dashboard navigation within the application. Final_Summary retention after browser refresh, tab closure, or navigation away from the application is not required.
