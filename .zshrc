#
# Executes commands at the start of an interactive session.
#
# Authors:
#   Sorin Ionescu <sorin.ionescu@gmail.com>
#

autoload -Uz compinit && compinit

# Source Prezto.
if [[ -s "${ZDOTDIR:-$HOME}/.zprezto/init.zsh" ]]; then
  # Check if we're in VS Code or Cursor
  if [[ $VSCODE_GIT_ASKPASS_MAIN == *"Visual Studio Code"* || $VSCODE_GIT_ASKPASS_MAIN == *"Cursor.app"* ]]; then
    # Save the current value of ZPREZTODIR
    ZPREZTODIR_ORIG=$ZPREZTODIR
    
    # Temporarily set PREZTO_THEME to an empty value to disable theme loading
    export ZPREZTODIR=/tmp/disabled_prezto_theme
    
    # Source Prezto
    source "${ZDOTDIR:-$HOME}/.zprezto/init.zsh"
    
    # Restore ZPREZTODIR
    export ZPREZTODIR=$ZPREZTODIR_ORIG
    
    # Set default prompt
    autoload -Uz promptinit && promptinit
    prompt default
  else
    # Regular Prezto sourcing with theme
    source "${ZDOTDIR:-$HOME}/.zprezto/init.zsh"
  fi
fi

# Customize to your needs...

export FZF_DEFAULT_OPTS='--height 40% --reverse --border'

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh


#export PATH=$HOME/.nodebrew/current/bin:$PATH
export PATH=/Users/yuuma/Library/Android/sdk/tools/bin:$PATH
export PATH=~/anaconda3/bin:$PATH

###-tns-completion-start-###
if [ -f /Users/yuuma/.tnsrc ]; then
    source /Users/yuuma/.tnsrc
fi
###-tns-completion-end-###

export JAVA_HOME=$(/usr/libexec/java_home)
export ANDROID_HOME=/Users/yuuma/Library/Android/sdk


# ヒストリに追加されるコマンド行が古いものと同じなら古いものを削除
setopt hist_ignore_all_dups

# スペースで始まるコマンド行はヒストリリストから削除
setopt hist_ignore_space

# ヒストリを呼び出してから実行する間に一旦編集可能
setopt hist_verify

# 余分な空白は詰めて記録
setopt hist_reduce_blanks

# 古いコマンドと同じものは無視
setopt hist_save_no_dups

# historyコマンドは履歴に登録しない
setopt hist_no_store

# 補完時にヒストリを自動的に展開
setopt hist_expand

# 履歴をインクリメンタルに追加
setopt inc_append_history

#　最終行に改行がない場合の表示
setopt promptsp
setopt promptcr
export PROMPT_EOL_MARK=''


function chpwd() { ls }
function gi() { curl -sLw "\n" https://www.toptal.com/developers/gitignore/api/$@ ;}

# Load nodenv automatically by appending
eval "$(nodenv init -)"

# Load rbenv automatically by appending
eval "$(rbenv init - zsh)"

# Load pyenv automatically by appending
eval "$(pyenv init -)"

# Load npm
eval "`npm completion`"

# Load Angular CLI autocompletion.
# source <(ng completion script)

# Added by LM Studio CLI (lms)
export PATH="$PATH:/Users/yuuma/.lmstudio/bin"

# Shell integration for VS Code or Cursor
if [[ $VSCODE_GIT_ASKPASS_MAIN == *"Visual Studio Code"* ]]; then
  source "$(code --locate-shell-integration-path zsh)"
elif [[ $VSCODE_GIT_ASKPASS_MAIN == *"Cursor.app"* ]]; then
  source "$(cursor --locate-shell-integration-path zsh)"
fi
