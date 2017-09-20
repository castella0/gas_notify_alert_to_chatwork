/**
var config = {

  CW_ENDPOINT: {
    rooms: 'https://api.chatwork.com/v2/rooms/'
  },

  CW_TOKEN: 'XXXXXXXXXXXXXXXXXXXXXXXX',
  CW_ROOM_ID: '9999999',

  TO_ACCOUNT_IDS: [
    1234567,
  ],

  ERROR_MAIL_SEARCH_CONDITION: 'to:alert@mail.com',
  WARN_MAIL_SEARCH_CONDITION: 'to:warn@mail.com',

  RECOVERY_LABEL: 'recovery',
  MAILING_LIST_NAME: 'mailing_list:',

  ADD_MSG: '直近のWARN',

  CACHE_KEY: {
    last_message_id: 'LAST_MESSAGE_ID',
    quiet_end_time: 'QUIET_END_TIME',
  },

  CW_COMMAND: ['cmd',],
  CW_COMMAND_QUIET: ['quiet',],
  CW_COMMAND_RETURN: ['return',],

  QUIET_SEC: 3600,

  QUIET_MSG: 'quiet {quiet_end_date}',
  RETURN_MSG: 'ok',

};
**/

var CACHE_KEY_LAST_ALERT_TIME = 'cache_last_alert_time';
var CACHE_KEY_LAST_ALERT_KEYWORD = 'cache_last_alert_keyword';


function notifyMail() {

  // 静音処理
  var cmd = checkChatworkRequestMsg();
  if (cmd) {
    if ('quiet' == cmd.cmd) {
      var quiet_end_time = set_quiet(config.QUIET_SEC);
      var quiet_end_date = new Date(quiet_end_time);
      var quiet_end_str = quiet_end_date.getFullYear() + '/'
                          + ('0' + (quiet_end_date.getMonth() + 1)).slice(-2) + '/'
                          + ('0' + quiet_end_date.getDate()).slice(-2) + ' '
                          + ('0' + quiet_end_date.getHours()).slice(-2) + ':'
                          + ('0' + quiet_end_date.getMinutes()).slice(-2) + ':'
                          + ('0' + quiet_end_date.getSeconds()).slice(-2);
      var body = config.QUIET_MSG.replace('{quiet_end_date}', quiet_end_str);
      postChatwork(
        config.CW_ENDPOINT.rooms + config.CW_ROOM_ID + '/messages',
        body,
        cmd.msg);
    } else if ('return' == cmd.cmd && is_quiet()) {
      remove_quiet();
      postChatwork(
        config.CW_ENDPOINT.rooms + config.CW_ROOM_ID + '/messages',
        config.RETURN_MSG,
        cmd.msg);
    }
  }

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
    ago.setMinutes(ago.getMinutes() - 30);
    // 簡略通知する期間チェック
    var sendEasyCheckTime = ago.getTime();
    // 追加情報を出す期間チェック
    ago.setMinutes(ago.getMinutes() - 30);
    var addDetailCheckTime = ago.getTime();

    // 簡略通知フラグ
    subjectKeywords = getSubjectKeywords(msgContent.subject);
    var isSendEasy = (lastAlertDate == null || sendEasyCheckTime <= lastAlertDate ) && isLikeKeywords(subjectKeywords, lastSubjectKeywords);

    // 最後にアラート通知したのが60分以上前、リカバリーの通知じゃなければ、追加情報も出す
    if (!isSendAlert && !isSendEasy && msgContent.subject.indexOf(config.RECOVERY_LABEL) < 0 && (lastAlertDate == null || lastAlertDate <= addDetailCheckTime)) {

      // 直前のアラートメール探す
      var additionalContents = [];
      var re = new RegExp('^\\[' + config.MAILING_LIST_NAME + '[0-9]*\\]');
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
      var postBody = msgContent.subject;
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

    if (!is_quiet()) {
      // 静音モードじゃない時だけpostする

      UrlFetchApp.fetch(config.CW_ENDPOINT.rooms + config.CW_ROOM_ID + '/messages', {
        headers: {
          'X-ChatWorkToken': config.CW_TOKEN
        },
        method: 'post',
        payload: 'body=' + encodeURIComponent( postBody )
      });
    }

    isSendAlert = true;

    msg.markRead();

    // API消費しそうなのでやらない
    // threads[i].moveToArchive();
  }

  if (isSendAlert) {
    // 最終アラート日時と、キーワードを保存
    cache.put(CACHE_KEY_LAST_ALERT_TIME, (new Date()).getTime(), 10800);
    cache.put(CACHE_KEY_LAST_ALERT_KEYWORD, subjectKeywords, 10800);
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


function isLikeKeywords(srcKeywordsStr, destKeywordsStr) {
  var result = false;

  var srcKeywords = srcKeywordsStr.split(',');
  var destKeywords = destKeywordsStr.split(',');

  var matchCount = 0;
  srcKeywords.forEach (function (keyword) {
    if ( 0 <= destKeywords.indexOf(keyword) ) {
      matchCount++;
    }
  });
  result = 2 <= matchCount;

  return result;
}


// チャットワークのメッセージを確認し、実行するアクションを決定する
function checkChatworkRequestMsg() {

  var result = null;

  // 投稿を取得
  var msgs = UrlFetchApp.fetch(config.CW_ENDPOINT.rooms + config.CW_ROOM_ID + '/messages?force=1', {
    headers: {
      'X-ChatWorkToken': config.CW_TOKEN
    },
    method: 'get'
  });
  if (null == msgs || '' == msgs ) return result;

  msgs = JSON.parse( msgs );
  if (msgs.length < 1) return result;

  var target_msgs = [];
  // キャッシュに、前回取得した際の最新メッセージが残っている
  var cache = CacheService.getScriptCache();
  var last_message_id = cache.get(config.CACHE_KEY.last_message_id);

  if (last_message_id) {
    var pass_last_message = false;
    msgs.forEach(function(value, index) {
      if (pass_last_message) {
        target_msgs.push(value);
      }
      if (value.message_id == last_message_id) {
        // 前回の最新メッセージより新しいものから先が今回の対象
        pass_last_message = true;
      }
    });
  }

  if (!target_msgs.length) {
    target_msgs[0] = msgs[msgs.length-1];
  }

  var target_msg = null;
  for (var i = 0, tmsgs_len = target_msgs.length; i < tmsgs_len; i++) {

    var target_msg = target_msgs[i];
    var check_strs = target_msg.body.split(/(\s+|　+)/);

    // コマンドのトリガーチェック
    var is_command = false;
    for (var str_index = 0, str_len = config.CW_COMMAND.length; !is_command && str_index < str_len; str_index++) {
      is_command = is_command || 0 <= check_strs.indexOf( config.CW_COMMAND[str_index] );
    }
    if (!is_command) {
      continue;
    }

    // コマンドチェック
    var is_quiet = false;
    for (var str_index = 0, str_len = config.CW_COMMAND_QUIET.length; !is_quiet && str_index < str_len; str_index++) {
      is_quiet = is_quiet || 0 <= check_strs.indexOf( config.CW_COMMAND_QUIET[str_index] );
    }
    if (is_quiet) {
      result = {
        cmd: 'quiet',
        msg: target_msg
      };
      break;
    }

    var is_return = false;
    for (var str_index = 0, str_len = config.CW_COMMAND_RETURN.length; !is_return && str_index < str_len; str_index++) {
      is_return = is_return || 0 <= check_strs.indexOf( config.CW_COMMAND_RETURN[str_index] );
    }
    if (is_return) {
      result = {
        cmd: 'return',
        msg: target_msg
      };
      break;
    }

  }

  if (result) {
    // しおり
    cache.put(config.CACHE_KEY.last_message_id, target_msg.message_id, 3600);
  }

  return result;
}


// 静音モード判定
function is_quiet() {

  var cache = CacheService.getScriptCache();
  var quiet_end_time = cache.get(config.CACHE_KEY.quiet_end_time);
  if (null == quiet_end_time) {
    return false;
  } else {
    quiet_end_time = +quiet_end_time;
  }

  var now = (new Date()).getTime();
  return now <= quiet_end_time;
}


// 静音モード設定
function set_quiet(quiet_sec) {

  var cache = CacheService.getScriptCache();
  var quiet_end_time = cache.get(config.CACHE_KEY.quiet_end_time);
  if (null == quiet_end_time) {
    quiet_end_time = (new Date()).getTime();
  } else {
    quiet_end_time = +quiet_end_time;
  }

  quiet_end_time += (quiet_sec * 1000);
  cache.put(config.CACHE_KEY.quiet_end_time, quiet_end_time, 21600);

  return quiet_end_time;
}


// 静音モード解除
function remove_quiet() {
  var cache = CacheService.getScriptCache();
  cache.remove(config.CACHE_KEY.quiet_end_time);
}


// チャットワークに投稿
function postChatwork(url, body, target_msg) {

  var post_body = '[rp aid=' + target_msg.account.account_id + ' to=' + config.CW_ROOM_ID + '-' + target_msg.message_id + ']' + target_msg.account.name + '\n';
  post_body += body;

  UrlFetchApp.fetch(url, {
    headers: {
      'X-ChatWorkToken': config.CW_TOKEN
    },
    method: 'post',
    payload: 'body=' + encodeURIComponent( post_body )
  });

}
