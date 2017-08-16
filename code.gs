/**
var config = {

  CW_ENDPOINT = {
    rooms: 'https://api.chatwork.com/v2/rooms/'
  },

  CW_TOKEN = 'XXXXXXXXXXXXXXXXXXXXXXXX',
  CW_ROOM_ID = '9999999',

  TO_ACCOUNT_IDS = [
    1234556,
  ],

  ERROR_MAIL_SEARCH_CONDITION = 'to:alert@mail.com',
  WARN_MAIL_SEARCH_CONDITION = 'to:warn@mail.com',

  RECOVERY_LABEL = 'recovery',
  MAILING_LIST_NAME = 'mailing_list:',

  ADD_MSG = '直近のWARN',
};
**/


var CACHE_KEY_LAST_ALERT_TIME = 'cache_last_alert_time';
var CACHE_KEY_LAST_ALERT_KEYWORD = 'cache_last_alert_keyword';

function notifyMail() {

  // 未読メールを取得する 検索クエリを変更すれば転送するメールを絞ることも可能
  var threads = GmailApp.search(config.ERROR_MAIL_SEARCH_CONDITION);

  if (threads == null || threads.length === 0) return;

  var isSendAlert = false;
  var subjectKeywords = '';

  for (var i = 0, tlen = threads.length; i < tlen; i++) {

    // API消費するみたいなのでチェック外す
    // if (!threads[i].isUnread()) continue;

    // 最後のメッセージを対象にする
    var msgs = threads[i].getMessages();
    var msg = msgs[msgs.length-1]
    // もし既読なら処理しない
    if (!msg.isUnread()) continue;

    var msgContent = getMsgContent(msg);

    var additionalText = '';

    // 前回のアラート日時
    var cache = CacheService.getScriptCache();
    var lastAlertDate = cache.get(CACHE_KEY_LAST_ALERT_TIME);
    if (null != lastAlertDate) {
      lastAlertDate = +lastAlertDate;
    }
    // 前回のアラートキーワード
    var lastSubjectKeywords = cache.get(CACHE_KEY_LAST_ALERT_KEYWORD);
    if (null == lastSubjectKeywords) {
      lastSubjectKeywords = '';
    }

    var ago = new Date();
    ago.setMinutes(ago.getMinutes() - 3);
    // 簡略通知する期間チェック
    var sendEasyCheckTime = ago.getTime();
    // 追加情報を出す期間チェック
    ago.setMinutes(ago.getMinutes() - 27);
    var addDetailCheckTime = ago.getTime();

    // 簡略通知フラグ
    subjectKeywords = getSubjectKeywords(msgContent.subject);
    var isSendEasy = (lastAlertDate == null || sendEasyCheckTime <= lastAlertDate ) && lastSubjectKeywords == subjectKeywords;

    // 最後にアラート通知したのが30分以上前、リカバリーの通知じゃなければ、追加情報も出す
    if (!isSendAlert && !isSendEasy && msgContent.subject.indexOf(config.RECOVERY_LABEL) < 0 && (lastAlertDate == null || lastAlertDate <= addDetailCheckTime)) {

      // 直前のアラートメール探す
      var additionalContents = [];
      var re = new RegExp('^\[' + config.MAILING_LIST_NAME + '[0-9]*\]');
      var label = msgContent.subject.match(re);

      var thisTimeNo = 0;
      if (null != label) {
        thisTimeNo = label[0].match(/\d+/);
        thisTimeNo = null != thisTimeNo ? +thisTimeNo : 0;
      }

      if ( 0 != thisTimeNo ) {

        var warnMailSubjects = '';
        for (var count = 1; count <= 10; count++) {
          warnMailSubjects += config.MAILING_LIST_NAME + (thisTimeNo - count) + ' ';
        }

        var additionalThreads = GmailApp.search(config.WARN_MAIL_SEARCH_CONDITION + ' {' + warnMailSubjects.trim() + '}');
        if (additionalThreads != null && additionalThreads.length !== 0) {

          for (var j = 0, atlen = additionalThreads.length; j < 2 && j < atlen; j++) {
            // 最後のメッセージを対象にする
            var additionalMsgs = additionalThreads[j].getMessages();
            var additionalMsg = additionalMsgs[additionalMsgs.length-1];
            additionalContents.push(getMsgContent(additionalMsg));
          }

        }
      }

      additionalContents.forEach (function (val, index, arr) {
        additionalText = additionalText
        + '[info][title]' + val.subject + '[/title]\n'
        + val.body + '[/info]' + '\n';
      });

    }

    // チャットワークルームのメンバー一覧取得
    var members = UrlFetchApp.fetch(config.CW_ENDPOINT.rooms + config.CW_ROOM_ID + '/members', {
      headers: {
        'X-ChatWorkToken': config.CW_TOKEN
      },
      method: 'get'
    });
    members = JSON.parse(members);

    // 決まった人にだけTOする
    var to = '';
    members.forEach(
      function (member) {
        if (config.TO_ACCOUNT_IDS.indexOf( member.account_id ) == -1) return;
        to += '[To:' + member.account_id + ']' + member.name + 'さん\n';
      }
    );

    if (isSendEasy) {
      var postBody = to + '[info]' + msgContent.subject + '[/info]';
    } else {
      var postBody = to
        + '[info][title]' + msgContent.subject + '\n'
        + 'from: ' + msgContent.from + '[/title]'
        + msgContent.body + '[/info]';
    }

    if ( additionalText ) {
      postBody = postBody
        + '[hr]' + config.ADD_MSG + '\n'
        + additionalText;
    }

    UrlFetchApp.fetch(config.CW_ENDPOINT.rooms + config.CW_ROOM_ID + '/messages', {
      headers: {
        'X-ChatWorkToken': config.CW_TOKEN
      },
      method: 'post',
      payload: 'body=' + encodeURIComponent( postBody )
    });

    isSendAlert = true;

    msg.markRead();

    // API消費しそうなのでやらない
    // threads[i].moveToArchive();
  }

  if (isSendAlert) {
    // 最終アラート日時と、キーワードを保存
    cache.put(CACHE_KEY_LAST_ALERT_TIME, (new Date()).getTime());
    cache.put(CACHE_KEY_LAST_ALERT_KEYWORD, subjectKeywords);
  }

}

function getMsgContent(msg) {

    var from = msg.getFrom();
    var subject = msg.getSubject();
    // 添付ファイルがあるときに時々エラーになるため、その場合は自前でプレーンテキスト化する
    var body;
    try {
      body = msg.getPlainBody();
    }
    catch(e) {
      body = msg.getBody().replace(/<br[^>]*>/g, '\n').replace(/<[^>]+>/g, '').replace(/&(lt|gt|quot|amp|nbsp|#x?[0-9]+);/g, function(w, $1) {
        if ($1.indexOf('#x') === 0) {
          return String.fromCharCode(parseInt($1.substr(2), 16));
        }
        if ($1.indexOf('#') === 0) {
          return String.fromCharCode(parseInt($1.substr(1), 10));
        }
        return ({
          lt: '<',
          gt: '>',
          quot: '"',
          amp: '&',
          nbsp: ' '
        })[$1];
      });
    }

    return { from: from, subject: subject, body: body };
}

function getSubjectKeywords(subject) {

  var keywords = [];
  var extractStr = subject.match(/\[\s.*\s\]/);
  if (null != extractStr) {
    var extractCharacters = extractStr[0].split('');
    var keyword = '';
    for (var i = 0, len = extractCharacters.length; i < len; i++) {
      var character = extractCharacters[i];
      if ('[' == character || ' ' == character) {
        continue;
      } else if (']' == character) {
        keywords.push( keyword );
        keyword = '';
      } else {
        keyword += character;
      }
    }
    if (keyword) {
      keywords.push( keyword );
    }
  }

  return keywords.join(',');
}