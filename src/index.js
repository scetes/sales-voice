require('dotenv').load();

var http       = require('http')
  , AlexaSkill = require('./AlexaSkill')
  , APP_ID = false //'amzn1.echo-sdk-ams.app.92fb95e3-4363-4c96-bc06-9dc9c17f9bc0'//'amzn1.echo-sdk-ams.app.b74b01aa-393c-4f1d-b75d-705f43f164ca'
  , nforce = require('nforce')
  , _ = require('lodash')
  , moment = require('moment-timezone')
  , pluralize = require('pluralize');

var url = function(path){
  return process.env.DBDIRECT_API20_BASE_URL + '/' + path;//'http://104.196.35.163:8088/api/contacts/' + key;
};

var org = nforce.createConnection({
  clientId: process.env.SF_CLIENT_ID,
  clientSecret: process.env.SF_CLIENT_SECRET,
  redirectUri: process.env.SF_REDIRECT_URL,
  mode: 'single'
});

var SF_USER = process.env.SF_USER;
var SF_PWD_TOKEN = process.env.SF_PWD_TOKEN;

var DB_API_BASE_URI = process.env.DB_API_BASE_URI;
var DB_API_ORGANIZATION_PATH_URI=process.env.DB_API_ORGANIZATION_PATH_URI;

var handleAccountExistIntent = function(intent, session, response){

  var company;
  var    text;
  var    Name;

  //the company name passed in, e.g., from an Alexa skill
  company = intent.slots.Account.value;

  var findCompanyURL;
  // note for DB Sandbox the keyword criteria is ignored.  A search returns static result for Gorman%20Manufacturing
  findCompanyURL = DB_API_BASE_URI + DB_API_ORGANIZATION_PATH_URI + '?KeywordText='+ company + '&SearchModeDescription=Basic&findcompany=true';

  //need to get the query right...look at sf
  var query = "Select Name from Account where Name like '" + company + "'";
  console.log('query: ' + query);

  //look for account by this name in salesforce
  // auth and run query
  org.authenticate({ username: SF_USER, password: SF_PWD_TOKEN }).then(function(){
    return org.query({ query: query })
  }).then(function(results) {

    //if found, say thanks
    speechOutput = 'Yes, ' + company + ' is an existing account.';

    var recs = results.records;
    //if not found, look up in dBDirect, create new account in Salesforce, say thanks
    if (recs.length == 0) {
      speechOutput = 'No ' + company + ' is not an existing account. I created a new account using Dunn and Bradstreet business directory' ;

      //getDataFromREST(findCompanyURL, function(data){

    }

    // Create speech output
    response.tellWithCard(speechOutput, "Salesforce", speechOutput);
  }).error(function(err) {
    var errorOutput = 'Darn, there was a Salesforce problem, sorry';
    response.tell(errorOutput, "Salesforce", errorOutput + err);
  });


};



var getDataFromREST = function(url, callback){
  var result;
  console.log('url' + url);
  http.get(url, function(res){
    var body = '';

    res.on('data', function(data){
      body += data;
    });

    res.on('end', function(){
      result = JSON.parse(body);
      callback(result);
    });

  }).on('error', function(e){
    console.log('Error: ' + e);
  });

};


// find any leads created today
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


// start a new session to create a lead
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


// collect the company name and create the actual lead
function handleLeadCompanyIntent(intent, session, response) {
  var speechOutput = "Bingo! I created a new lead for  "
    + session.attributes.name + " with the company name " + intent.slots.Company.value;
  var names = session.attributes.name.split(' ');
  var obj = nforce.createSObject('Lead');
  obj.set('FirstName', names[0]);
  obj.set('LastName', names[1]);
  obj.set('Company', intent.slots.Company.value);

  org.authenticate({ username: SF_USER, password: SF_PWD_TOKEN }).then(function(){
    return org.insert({ sobject: obj })
  }).then(function(results) {
    if (results.success) {
      response.tellWithCard(speechOutput, "Salesforce", speechOutput);
    } else {
      speechOutput = 'Darn, there was a salesforce problem, sorry.';
      response.tellWithCard(speechOutput, "Salesforce", speechOutput);
    }
  }).error(function(err) {
    var errorOutput = 'Darn, there was a Salesforce problem, sorry';
    response.tell(errorOutput, "Salesforce", errorOutput);
  });
}


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
  var output = 'Welcome to Salesy. ' +
    'Ask if a contact exists in CRM or ask for details for contact.';

  var reprompt = 'Which contact do you want to know about?';

  response.ask(output, reprompt);

  console.log("onLaunch requestId: " + launchRequest.requestId
      + ", sessionId: " + session.sessionId);
};

SalesVoiceSkill.prototype.intentHandlers = {
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