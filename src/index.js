require('dotenv').load();

var http = require('https')
    , AlexaSkill = require('./AlexaSkill')
    , APP_ID = false //'amzn1.echo-sdk-ams.app.92fb95e3-4363-4c96-bc06-9dc9c17f9bc0'//'amzn1.echo-sdk-ams.app.b74b01aa-393c-4f1d-b75d-705f43f164ca'
    , nforce = require('nforce')
    , _ = require('lodash')
    , moment = require('moment-timezone')
    , pluralize = require('pluralize')
    , AWS = require('aws-sdk');

// Configure the instance to prepare for integration with AWS.  these are Jason's secrets
AWS.config.update({accessKeyId: 'AKIAJKJ6DYKSQHQQIRFQ', secretAccessKey: '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'});
AWS.config.update({"region":"us-east-1"});


// Init an instance of Lambda.
var lambda = new AWS.Lambda();

// Function pointer for callback handler.  Used for create
var snsCallback = function(err, data) {

  // Did an error occur?
  if (err)
    console.log(err);
  else
    console.log(data);
};


// Object that contains the Lambda input parameters.
var snsParam = {
  "FunctionName": "bk-sns",
  "Payload": '{"arn":"arn":"arn:aws:sns:us-east-1:724245399934:bk-stn-sms", "message":"Message from Alexa lambda - macek"}'
};


//sqs arn: arn:aws:lambda:us-east-1:724245399934:function:bk-sqs
//sns arn: arn:aws:sns:us-east-1:724245399934:bk-stn-sms

/**
 * connection to salesforce using the nforce library
 */
var org = nforce.createConnection({
  clientId: process.env.SF_CLIENT_ID,
  clientSecret: process.env.SF_CLIENT_SECRET,
  redirectUri: process.env.SF_REDIRECT_URL,
  mode: 'single'
});
// user and pwd are used in each call to salesforce, in single user mode
var SF_USER = process.env.SF_USER;
var SF_PWD_TOKEN = process.env.SF_PWD_TOKEN;

/**
 *
 * not using this function anymore.  had originally created this
 * to test calling out to my dummy crm service
 * keeping it around in case need arises to hit another rest service
 */
var getDataFromREST = function(options, callback){
  var result;
  console.log('options' + options);

  //callback({FindCompanyResponse: 'db direct fake'});

  http.get(options, function(res){
    var body = 'no reponse, prob an error';

    res.on('data', function(data){
      body += data;
      console.log('response data ' + data)
    });

    res.on('end', function(){
      result = JSON.parse(body);
      callback(result);
    });


  }).on('error', function(e){
    console.log('Error: ' + e);

  });
};


/**
 *
 * query Salesforce for a list of leads -- hardcoded for 'today'
 * Alexa utterance example: 'new leads' or 'my leads'
 * careful -- 'new lead' is different intent for creating a new lead
 */
function handleLeadsTodayIntent(response) {
  var speechOutput = 'saywhat'; 
  var query = 'Select Name, Company from Lead where CreatedDate = TODAY';

  // auth and run query
  org.authenticate({ username: SF_USER, password: SF_PWD_TOKEN }).then(function(){
    return org.query({ query: query })
  }).then(function(results) {
    speechOutput = 'Sorry, you do not have any new leads for today.';
    var recs = results.records;

    if (recs.length > 0) {
      speechOutput = 'You have ' + recs.length + ' new ' + pluralize('lead', recs.length) + ', ';
      for (i=0; i < recs.length; i++){
        speechOutput +=  i+1 + ', ' + recs[i].get('Name') + ' from ' + recs[i].get('Company') + ', ';
        if (i === recs.length-2) speechOutput += ' and ';
      }
      speechOutput += ', have a great day!';
    }

    // Create speech output
    response.tellWithCard(speechOutput, "Salesforce", speechOutput);
  }).error(function(err) {
    var errorOutput = 'Darn, there was a Salesforce problem, sorry';
    response.tell(errorOutput, "Salesforce", errorOutput);
  });
}


/**
 *
 * handles the Alexa intent for stating the new lead interaction
 * Alexa utterance example: 'new lead'
 *
 * @param session
 * @param response
 */
function handleLeadStartIntent(session, response) {
  var speechOutput = "OK, let's create a new lead., What is the person's first and last name?";
  response.ask(speechOutput);
}

// continue the session, collect the person's name
function handleLeadNameIntent(intent, session, response) {
  var speechOutput = "Got it. the name is, " + intent.slots.Name.value + "., What is the company name?";
  session.attributes.name = intent.slots.Name.value;
  response.ask(speechOutput);
}

/**
 * collect the company name and create the actual lead or opportunity
 * Alexa utterance example: 'company is IBM'
 * note, it's important to utter 'company is' before saying the company name.
 * @param intent
 * @param session
 * @param response
 */
function handleLeadCompanyIntent(intent, session, response) {
  var sqsParam;
  var names = session.attributes.name.split(' ');
  var query = "Select Name, Id from Account where Name like '" + intent.slots.Company.value + "'";

  console.log('query: ' + query);
  org.authenticate({ username: SF_USER, password: SF_PWD_TOKEN }).then(function() {
    return org.query({query: query})

  }).then(function(results){ // this result is from the query to salesforce
    var recs = results.records;
    //if company not found in salesforce, create the lead
    if (recs.length == 0) {
      console.log('company not found. try to create lead');
      speechOutput = 'created lead for ' + names[1] + ' at ' + intent.slots.Company.value;
      var obj = nforce.createSObject('Lead');
      obj.set('FirstName', names[0]);
      obj.set('LastName', names[1]);
      obj.set('Company', intent.slots.Company.value);
      return org.insert({ sobject: obj })
    }
    else{//if company is already an account, then create an opportunity  not a lead
      console.log('account exists for company. try to create opportunity');
      console.log('recs: ' + JSON.stringify(recs));
      speechOutput = 'created opportunity for ' + intent.slots.Company.value;

      var opp = nforce.createSObject('Opportunity');
      opp.set('Name', intent.slots.Company.value + '-' +names[1] );
      opp.set('StageName', 'Prospecting');
      opp.set('CloseDate', '2017-01-01T18:25:43.511Z');//2017-01-01T18:25:43.511Z
      opp.set('AccountId', '00137000009eTf1AAE')

      return org.insert({ sobject: opp })
    }
  }).then(function(results) { // this result is from the insert operation to salesforce
    if (results.success) {
      console.log('insert results: ' + JSON.stringify(results));
      response.tellWithCard(speechOutput, "Salesforce", speechOutput);
    } else {
      speechOutput = 'a salesforce problem with inserting object';
      response.tellWithCard(speechOutput, "Salesforce", speechOutput);
    }
  }).then(function () {
        sqsParam = {
          "FunctionName": "bk-sqs",
          "Payload": JSON.stringify({
            "arn": "'arn':'arn:aws:lambda:us-east-1:724245399934:bk-sqs'",
            "industry": "technology",
            "opportunityName": intent.slots.Company.value + '-' +names[1]
          })
        };
        lambda.invoke(sqsParam, function(err, data) { // send data to lambda for sns topic
    // Did an error occur?
    if (err)
      console.log('error calling lambda with params: ' + JSON.stringify(sqsParam), JSON.stringify(err));
    else
      console.log('success calling lambda with params: ' + JSON.stringify(sqsParam), JSON.stringify(data));
  })}).error(function(err) {
    var errorOutput = 'Darn, there was a Salesforce problem, sorry';
    response.tell(errorOutput + ' : ' + err, "Salesforce", errorOutput);
  });
}


/**
 *
 * Handles the Alexa intent for creating a new opportunity
 * utterance example: create opportunity Walmart
 * successful create response looks like:
 *
 * {
 *   "id": "00637000007eT6PAAU",
 *   "success": true,
 *   "errors": []
 * }
 *
 */
var handleNewOpportunityIntent = function(intent, session, response){

  var speechOutput;
  var opp;

  opp = nforce.createSObject('Opportunity');
  //todo: set the name as a concat of company name from session and today's date
  opp.set('Name', intent.slots.OpportunityName.value);
  opp.set('StageName', 'Prospecting');
  opp.set('CloseDate', '2017-01-01T18:25:43.511Z');//2017-01-01T18:25:43.511Z
  console.log(opp);
  // auth and run query.  Use Promise 'then' to chain the callbacks with one common error function
  org.authenticate({username: SF_USER, password: SF_PWD_TOKEN}).then(function () {
    return org.insert({sobject: opp})
  }).then(function (results) {
    if (results.success) {
      speechOutput = 'Opportunity created.';
      response.tellWithCard(speechOutput, "Salesforce", speechOutput);
    } else {
      speechOutput = 'There was a problem with a salesforce creating new opportunity.';
      response.tellWithCard(speechOutput, "Salesforce", speechOutput);
    }
  }).error(function (err) {
    var errorOutput = 'Darn, there was a Salesforce problem, sorry';
    response.tell(errorOutput + ' : ' + err, "Salesforce", errorOutput + err);
  });

};

/**
 *  Handles the Alexa intent to ask if a company is an existing account in salesforce
 *  Alexa utterance example: 'is IBM an account'
 * @param intent
 * @param session
 * @param response
 */
var handleAccountExistIntent = function(intent, session, response){

  var company;
  var    text;
  var    Name;
  var speechOutput = 'hello';

  //the company name passed in, e.g., from an Alexa skill
  company = intent.slots.Account.value;

  //not sure how the 'like' works in SOQL.  need to research
  var query = "Select Name from Account where Name like '" + company + "'";
  console.log('query: ' + query);

  //look for account by this name in salesforce
  // auth and run query
  org.authenticate({ username: SF_USER, password: SF_PWD_TOKEN }).then(function(){
    return org.query({ query: query })
  }).then(function(results) {

    //if found,
    speechOutput = 'Yes, ' + company + ' is an existing account.';

    var recs = results.records;
    //if not found, look up in dBDirect -- need to fake this out for now.  DBDirect REST call giving me fits in nodejs
    if (recs.length == 0) {
      speechOutput = 'No ' + company + ' is not an existing account. I created a new account using Dunn and Bradstreet business directory' ;
    }

    // Create speech output
    response.tellWithCard(speechOutput, "Salesforce", speechOutput);
  }).error(function(err) {
    var errorOutput = 'Darn, there was a Salesforce problem, sorry';
    response.tell(errorOutput, "Salesforce", errorOutput + err);
  });


};


var SalesVoiceSkill = function(){
  AlexaSkill.call(this, APP_ID);
};

SalesVoiceSkill.prototype = Object.create(AlexaSkill.prototype);
SalesVoiceSkill.prototype.constructor = SalesVoiceSkill;

SalesVoiceSkill.prototype.eventHandlers.onSessionStarted = function(sessionStartedRequest, session){
  // What happens when the session starts? Optional
  console.log("onSessionStarted requestId: " + sessionStartedRequest.requestId
      + ", sessionId: " + session.sessionId);
};



SalesVoiceSkill.prototype.eventHandlers.onLaunch = function(launchRequest, session, response){
  // This is when they launch the skill but don't specify what they want. Prompt them to ask for something
  var output = 'Welcome to Salesvoice';

  var reprompt = 'Which contact do you want to know about?';

  response.ask(output, reprompt);

  console.log("onLaunch requestId: " + launchRequest.requestId
      + ", sessionId: " + session.sessionId);
};

SalesVoiceSkill.prototype.intentHandlers = {

//  AccountMatchIntent: function(intent, session, response){
//    handleAccountMatchIntent(intent, session, response);
//  },

  NewOpportunityIntent: function(intent, session, response){
    handleNewOpportunityIntent(intent, session, response);
  },


  AccountExistIntent: function(intent, session, response){
    handleAccountExistIntent(intent, session, response);
  },

    // check for any new leads
  LeadsTodayIntent: function (intent, session, response) {
      handleLeadsTodayIntent(response);
  },

  // start the new lead creation process
  LeadStartIntent: function (intent, session, response) {
      handleLeadStartIntent(session, response);
  },

    // add the name to the lead session
  LeadNameIntent: function (intent, session, response) {
      handleLeadNameIntent(intent, session, response);
  },

  // get the name and create the lead
  LeadCompanyIntent: function (intent, session, response) {
      handleLeadCompanyIntent(intent, session, response);
  },


  HelpIntent: function(intent, session, response){
    var speechOutput = 'Ask about a contact.  Which contact do you need to get details for?';
    response.ask(speechOutput);
  }
};

    exports.handler = function(event, context) {
    var skill = new SalesVoiceSkill();
    skill.execute(event, context);

};